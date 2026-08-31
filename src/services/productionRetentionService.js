const cron = require('node-cron');
const pool = require('../database/config');
const logger = require('../utils/logger');

/**
 * Keeps the production change log from growing without bound.
 *
 * Measured on real-shaped rows: 537 bytes with the before/after snapshots,
 * 238 bytes without. At 200 changes a day that is 37 MB a year kept whole, or
 * 17 MB a year once the snapshots are dropped.
 *
 * So there are two different questions, and they get two different answers:
 *
 *   Can this be restored?   Only worth keeping for a while. Restoring is for
 *                           catching a recent mistake, not for archaeology, and
 *                           the snapshots are the bulk of the size.
 *   What happened, and who?  Worth keeping for years. It is the audit trail the
 *                           plan is judged by, and stripped rows are tiny.
 *
 * Hence: strip the snapshots after DETAIL_DAYS, delete the row after
 * PURGE_DAYS. At 200 changes a day the table settles around 50 MB and stops
 * growing.
 *
 * Both are configurable, and PURGE_DAYS=0 disables deletion entirely for anyone
 * who wants to keep the log forever.
 *
 * Published revisions (migration 030) get the same treatment for the same
 * reason: the snapshot is the bulk of the row and is only worth keeping while
 * someone might want to compare against it, while "CW 36 was published at 14:20
 * by Jana, 7 changes" is the record of what the shop floor was told and costs
 * almost nothing to keep.
 *
 * With one hard exception: the newest revision of each week is never touched.
 * That is not history, it is what the viewer renders - pruning it would blank
 * the plan on the floor.
 */

const DETAIL_DAYS = Number(process.env.PRODUCTION_LOG_DETAIL_DAYS || 90);
const PURGE_DAYS = Number(process.env.PRODUCTION_LOG_PURGE_DAYS || 1095); // 3 years

const REVISION_DETAIL_DAYS = Number(process.env.PRODUCTION_REVISION_DETAIL_DAYS || 90);
const REVISION_PURGE_DAYS = Number(process.env.PRODUCTION_REVISION_PURGE_DAYS || 1095);

class ProductionRetentionService {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  static get detailDays() {
    return DETAIL_DAYS;
  }

  /**
   * Drop the restore snapshots from rows older than DETAIL_DAYS.
   *
   * The row itself stays: action, summary, who and when survive, so the history
   * panel still shows what happened - it just cannot put it back any more.
   */
  async stripOldPayloads() {
    if (!Number.isFinite(DETAIL_DAYS) || DETAIL_DAYS <= 0) return 0;

    const { rowCount } = await pool.query(
      `UPDATE production_change_log
          SET before_state = NULL, after_state = NULL
        WHERE changed_at < NOW() - ($1 || ' days')::interval
          AND (before_state IS NOT NULL OR after_state IS NOT NULL)`,
      [DETAIL_DAYS]
    );
    return rowCount;
  }

  /** Remove rows older than PURGE_DAYS. Disabled when PURGE_DAYS is 0. */
  async purgeOldRows() {
    if (!Number.isFinite(PURGE_DAYS) || PURGE_DAYS <= 0) return 0;

    const { rowCount } = await pool.query(
      `DELETE FROM production_change_log
        WHERE changed_at < NOW() - ($1 || ' days')::interval`,
      [PURGE_DAYS]
    );
    return rowCount;
  }

  /**
   * Drop the snapshot from superseded revisions older than the detail window.
   *
   * "Superseded" is doing the work here: the newest revision of every week is
   * excluded whatever its age, because that is the copy the floor is reading.
   * A week published once a year ago and never since keeps its snapshot.
   */
  async stripOldRevisions() {
    if (!Number.isFinite(REVISION_DETAIL_DAYS) || REVISION_DETAIL_DAYS <= 0) return 0;

    const { rowCount } = await pool.query(
      `UPDATE production_plan_revisions r
          SET snapshot = NULL
        WHERE r.published_at < NOW() - ($1 || ' days')::interval
          AND r.snapshot IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM production_plan_revisions newer
             WHERE newer.location_id = r.location_id
               AND newer.week_start  = r.week_start
               AND newer.revision    > r.revision
          )`,
      [REVISION_DETAIL_DAYS]
    );
    return rowCount;
  }

  /** Remove superseded revision rows older than the purge window. */
  async purgeOldRevisions() {
    if (!Number.isFinite(REVISION_PURGE_DAYS) || REVISION_PURGE_DAYS <= 0) return 0;

    const { rowCount } = await pool.query(
      `DELETE FROM production_plan_revisions r
        WHERE r.published_at < NOW() - ($1 || ' days')::interval
          AND EXISTS (
            SELECT 1 FROM production_plan_revisions newer
             WHERE newer.location_id = r.location_id
               AND newer.week_start  = r.week_start
               AND newer.revision    > r.revision
          )`,
      [REVISION_PURGE_DAYS]
    );
    return rowCount;
  }

  async runDaily() {
    try {
      const stripped = await this.stripOldPayloads();
      const purged = await this.purgeOldRows();
      const revisionsStripped = await this.stripOldRevisions();
      const revisionsPurged = await this.purgeOldRevisions();

      if (stripped || purged || revisionsStripped || revisionsPurged) {
        logger.info('Production log retention applied', {
          snapshotsStripped: stripped,
          rowsPurged: purged,
          revisionSnapshotsStripped: revisionsStripped,
          revisionsPurged,
          detailDays: DETAIL_DAYS,
          purgeDays: PURGE_DAYS,
          revisionDetailDays: REVISION_DETAIL_DAYS,
          revisionPurgeDays: REVISION_PURGE_DAYS
        });
      }
    } catch (error) {
      // Housekeeping must never take the app down.
      logger.error('Production log retention failed', { error: error.message });
    }
  }

  start() {
    if (this.isRunning) return;

    // 03:10, after the warehouse backup at 02:30 - two heavy jobs at once on a
    // small VPS is worth avoiding.
    this.cronJob = cron.schedule('10 3 * * *', () => this.runDaily());
    this.isRunning = true;

    logger.info('Production log retention started', {
      schedule: 'daily at 03:10',
      detailDays: DETAIL_DAYS,
      purgeDays: PURGE_DAYS || 'never',
      revisionDetailDays: REVISION_DETAIL_DAYS,
      revisionPurgeDays: REVISION_PURGE_DAYS || 'never'
    });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
    }
  }
}

module.exports = ProductionRetentionService;
