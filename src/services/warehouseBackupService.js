const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const pool = require('../database/config');
const logger = require('../utils/logger');

// Warehouse tables in dependency order (parents first — used for restore).
const WAREHOUSE_TABLES = [
  'material_categories',
  'pallet_locations',
  'materials',
  'material_placements',
  'material_movements',
  'warehouse_audit_log'
];

const RETENTION_DAYS = 3;
const FILE_RE = /^warehouse-\d{8}-\d{6}\.json$/;

class WarehouseBackupService {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  backupDir() {
    const base = process.env.BACKUP_DIR || '/app/backups';
    return path.join(base, 'warehouse');
  }

  ensureDir() {
    const dir = this.backupDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Only allow our own backup filenames (guards against path traversal).
  safeFile(name) {
    if (!name || !FILE_RE.test(name)) return null;
    return path.join(this.backupDir(), name);
  }

  // Build a timestamped filename: warehouse-YYYYMMDD-HHmmss.json
  stampName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `warehouse-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  }

  // Snapshot every warehouse table into a single JSON file.
  async createBackup(trigger = 'manual') {
    const dir = this.ensureDir();
    const tables = {};
    const counts = {};
    for (const t of WAREHOUSE_TABLES) {
      const res = await pool.query(`SELECT * FROM ${t} ORDER BY id ASC`);
      tables[t] = res.rows;
      counts[t] = res.rows.length;
    }
    const payload = {
      version: 1,
      type: 'warehouse',
      trigger,
      created_at: new Date().toISOString(),
      counts,
      tables
    };
    const name = this.stampName();
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(payload));
    const size = fs.statSync(file).size;
    logger.info('Warehouse backup created', { name, counts, trigger });
    return { name, size, counts, created_at: payload.created_at };
  }

  // List existing backups (newest first) with lightweight metadata.
  listBackups() {
    const dir = this.ensureDir();
    return fs.readdirSync(dir)
      .filter(f => FILE_RE.test(f))
      .map(f => {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        let counts = null, created_at = stat.mtime.toISOString();
        try {
          const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
          counts = parsed.counts || null;
          created_at = parsed.created_at || created_at;
        } catch (e) { /* ignore unreadable file */ }
        const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
        return { name: f, size: stat.size, created_at, counts, total_rows: total };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // Restore the warehouse from a backup file. Destructive: replaces all
  // warehouse data with the snapshot, inside one transaction.
  async restoreBackup(name) {
    const file = this.safeFile(name);
    if (!file || !fs.existsSync(file)) {
      throw new Error('Backup not found');
    }
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!payload.tables) throw new Error('Invalid backup file');

    const serialize = (v) => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v;
      if (typeof v === 'object') return JSON.stringify(v); // jsonb / arrays
      return v;
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear all warehouse tables (CASCADE stays within the warehouse set)
      await client.query(
        `TRUNCATE ${WAREHOUSE_TABLES.join(', ')} RESTART IDENTITY CASCADE`
      );

      const restored = {};
      // Insert parents first
      for (const t of WAREHOUSE_TABLES) {
        const rows = Array.isArray(payload.tables[t]) ? payload.tables[t] : [];
        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map(c => serialize(row[c]));
          const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO ${t} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${ph})`,
            vals
          );
        }
        restored[t] = rows.length;
        // Reset the id sequence so future inserts don't collide
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'),
                         GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 1), 1))`,
          [t]
        );
      }

      await client.query('COMMIT');
      logger.info('Warehouse backup restored', { name, restored });
      return { name, restored };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Warehouse restore failed', { name, error: err.message });
      throw err;
    } finally {
      client.release();
    }
  }

  // Delete backups older than RETENTION_DAYS.
  pruneOld() {
    const dir = this.ensureDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!FILE_RE.test(f)) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
      } catch (e) { /* ignore */ }
    }
    if (removed) logger.info('Pruned old warehouse backups', { removed, retentionDays: RETENTION_DAYS });
    return removed;
  }

  async runDaily() {
    try {
      await this.createBackup('scheduled');
      this.pruneOld();
    } catch (err) {
      logger.error('Scheduled warehouse backup failed', { error: err.message });
    }
  }

  // Daily at 02:30 — create a fresh snapshot and drop anything older than 3 days.
  start() {
    if (this.isRunning) return;
    this.cronJob = cron.schedule('30 2 * * *', () => this.runDaily());
    this.isRunning = true;
    // Also prune on boot so stale files don't linger after downtime
    try { this.pruneOld(); } catch (e) { /* ignore */ }
    logger.info('Warehouse backup service started', { schedule: 'daily at 02:30', retentionDays: RETENTION_DAYS });
  }

  stop() {
    if (this.cronJob) { this.cronJob.stop(); this.isRunning = false; }
  }
}

module.exports = WarehouseBackupService;
