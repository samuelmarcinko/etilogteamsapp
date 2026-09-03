const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requirePermission } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const SapAvailability = require('../services/sapAvailability');
const SapSyncService = require('../services/sapSyncService');
const { SapClient } = require('../services/sapClient');

/**
 * What SAP knows about a project, for the planner.
 *
 * Three reads and one write, and the write goes to OUR table, never to SAP -
 * see services/sapClient.js, where that is enforced in code. Everything here
 * reads the local mirror, so a dropped VPN tunnel makes the answer older, never
 * absent.
 *
 * None of this is allowed to block planning. The availability answer is
 * information the boss weighs, not a rule he has to satisfy: he can put a batch
 * on a day with nothing at all in stock, and the screen's job is to tell him
 * what he will have to chase.
 *
 * Gating matches the rest of the production plan: production.view to look,
 * production.manage to record a decision about what a component is.
 */
const viewAccess = [verifyToken, attachDbRole,
  requirePermission('production.view', { legacyRoles: ['admin'] })];

const manageAccess = [verifyToken, attachDbRole,
  requirePermission('production.manage', { legacyRoles: ['admin'] })];

const currentUser = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });

/**
 * The finished-good projects to choose from.
 *
 * Deliberately the whole list in one response rather than a search endpoint:
 * there are around 46 open at a time, a few kilobytes altogether, so the box
 * filters as fast as the planner types instead of waiting on a request per
 * keystroke.
 */
router.get('/projects', viewAccess, asyncHandler(async (req, res) => {
  const [items, syncedAt] = await Promise.all([
    SapAvailability.projects(),
    SapAvailability.lastSyncedAt()
  ]);

  res.json({
    success: true,
    data: {
      projects: items,
      syncedAt,
      // Null when the mirror has never been filled - the screen then says SAP
      // is not connected rather than showing an empty list as if there were no
      // work.
      sapEnabled: SapClient.enabled,
      blockedBy: SapClient.misconfigured
    }
  });
}));

/**
 * How long a live read may hold up the dialog.
 *
 * A project costs roughly 25 round trips over the tunnel. Past this the answer
 * is no longer worth waiting for and the mirror - at most fifteen minutes old -
 * is the better one to show. The read itself is not cancelled; if it finishes
 * afterwards the mirror simply gets fresher for the next person.
 */
const LIVE_TIMEOUT_MS = Number(process.env.SAP_LIVE_TIMEOUT_MS || 15000);

/** Resolve to whatever comes first: the read, or the clock. */
function within(ms, work) {
  return Promise.race([
    work,
    new Promise((resolve) => setTimeout(
      () => resolve({ ok: false, reason: `SAP did not answer within ${Math.round(ms / 1000)} s` }),
      ms
    ))
  ]);
}

/**
 * The material picture for one batch.
 *
 * `qty` is the batch going on the day, not the order total. Passing the order
 * total instead would raise an alarm on nearly every project, which is exactly
 * what made two earlier versions of this check useless.
 *
 * With `live=1` the project is re-read from SAP first, so the stock figures are
 * today's rather than up to fifteen minutes old. That read can fail - a dropped
 * tunnel, a slow server - and when it does the answer is still returned, built
 * from the mirror, with `live.ok` false and the reason. The screen says which
 * of the two it is looking at; planning never waits on SAP being up.
 */
router.get('/availability', viewAccess, asyncHandler(async (req, res) => {
  const entry = Number(req.query.order);
  if (!Number.isInteger(entry) || entry <= 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'order must be a SAP order number' });
  }

  const qty = Number(req.query.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'qty must be a number' });
  }

  const known = await SapAvailability.order(entry);
  if (!known) {
    return res.status(404).json({ error: 'Not Found', message: 'That SAP order is not in the mirror' });
  }

  let live = null;
  if (req.query.live === '1' || req.query.live === 'true') {
    live = await within(LIVE_TIMEOUT_MS, SapSyncService.shared().refreshOne(known.itemCode));
  }

  // Read after the refresh, so a successful live read is what comes back.
  const answer = await SapAvailability.forOrder(entry, qty);
  res.json({ success: true, data: { ...answer, live } });
}));

/**
 * Record that a component is a construction, a bag, or not worth showing.
 *
 * Writes to sap_item_kinds with source='manual', which the sync never
 * overwrites - so one click settles an item for every project it appears in,
 * permanently, and the next automatic pass leaves it alone.
 */
router.put('/kinds/:itemCode', manageAccess, asyncHandler(async (req, res) => {
  const itemCode = String(req.params.itemCode || '').trim();
  if (!itemCode) {
    return res.status(400).json({ error: 'Bad Request', message: 'itemCode is required' });
  }

  const result = await SapAvailability.setKind(itemCode, req.body.kind, currentUser(req));
  if (result.badKind) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'kind must be konstrukcia, taska or ignoruj'
    });
  }

  res.json({ success: true, data: result.kind });
}));

/** Whether the mirror is current, and when it last filled. For the screen's footer. */
router.get('/status', viewAccess, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: SapClient.enabled,
      blockedBy: SapClient.misconfigured,
      readOnly: true,
      lastRun: await SapSyncService.lastRun()
    }
  });
}));

module.exports = router;
