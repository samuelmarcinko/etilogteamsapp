/**
 * API client for the Production Plan SPA.
 *
 * Same origin as /portal/, so the Azure AD token the portal already put in
 * localStorage is reused as-is. There is no second login.
 */

const TOKEN_KEY = 'etilog_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private mode or blocked storage - treated as signed out.
    return null;
  }
}

/**
 * Hand the user back to the portal login, remembering where they were so they
 * land back on the same week afterwards.
 */
export function redirectToLogin() {
  try {
    sessionStorage.setItem('production_return_to', window.location.href);
  } catch {
    // Not worth failing the redirect over.
  }
  window.location.href = '/login';
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new ApiError('Not signed in', 401);
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });

  if (response.status === 401) {
    // The token expired. The portal owns the MSAL session, so send the user
    // there to refresh rather than running a second MSAL instance here.
    redirectToLogin();
    throw new ApiError('Session expired', 401);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message || body.error || `Request failed (${response.status})`, response.status);
  }

  return response.json();
}

/** Thrown when a move lands on a slot that already holds production. */
export class SlotOccupiedError extends ApiError {
  constructor(occupants) {
    super('The target slot already contains production', 409);
    this.name = 'SlotOccupiedError';
    this.occupants = occupants;
  }
}

const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  /** Current user, including permissions[] and accessControlMode. */
  me: () => request('/api/admin/me').then((r) => r.data),

  locations: () => request('/api/production/locations').then((r) => r.data),

  /**
   * Everything the grid needs for one location over one date range.
   *
   * `published` asks for the last published revision of each week instead of
   * the live rows - what the shop floor reads. Same shape either way.
   */
  plan: ({ location, from, to, published = false }) =>
    request(
      `/api/production/plan?location=${encodeURIComponent(location)}&from=${from}&to=${to}` +
      (published ? '&published=1' : '')
    ).then((r) => r.data),

  /** Which weeks differ from what the floor was last told, and by how much. */
  pending: ({ location, from, to }) =>
    request(`/api/production/pending?location=${encodeURIComponent(location)}&from=${from}&to=${to}`)
      .then((r) => r.data),

  /** Publish the named weeks. One event, one transaction. */
  publish: ({ location, weeks }) =>
    request('/api/production/publish', json({ location, weeks })).then((r) => r.data),

  entry: (id) => request(`/api/production/entries/${id}`).then((r) => r.data),

  unscheduled: (location) =>
    request(`/api/production/unscheduled?location=${encodeURIComponent(location)}`).then((r) => r.data),

  searchProducts: (q) =>
    request(`/api/production/products?q=${encodeURIComponent(q)}`).then((r) => r.data),

  createProduct: (fgNumber, description) =>
    request('/api/production/products', json({ fgNumber, description })).then((r) => r.data),

  // --------------------------------------------------------------------- SAP
  // All four read our own mirror of SAP, never SAP itself, so they answer at
  // local speed and keep answering when the VPN tunnel is down - the reply just
  // carries an older syncedAt. Nothing here can block planning: the material
  // picture is information the planner weighs, not a rule to satisfy.

  /**
   * Every open finished-good project, in one response.
   *
   * There are around 46, a few kilobytes altogether, so the picker filters them
   * in the browser as fast as someone types instead of waiting on a request per
   * keystroke.
   */
  sapProjects: () => request('/api/production/sap/projects').then((r) => r.data),

  /**
   * Constructions and bags for one batch.
   *
   * `qty` is the batch going on the day, not the order total - an order for 425
   * with 122 done is fine for a batch of 50.
   */
  sapAvailability: (order, qty) =>
    request(`/api/production/sap/availability?order=${encodeURIComponent(order)}&qty=${encodeURIComponent(qty)}`)
      .then((r) => r.data),

  /**
   * Record what a component really is.
   *
   * Stored against the item, so marking a StackMaxx lid a construction settles
   * it for every project it appears in, and the sync never overwrites it.
   */
  setSapKind: (itemCode, kind) =>
    request(`/api/production/sap/kinds/${encodeURIComponent(itemCode)}`, {
      method: 'PUT',
      body: JSON.stringify({ kind })
    }).then((r) => r.data),

  /** Correct an FG's description. It belongs to the FG, not to one card. */
  updateProduct: (id, description) =>
    request(`/api/production/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description })
    }).then((r) => r.data),

  // ------------------------------------------------------------------ writes
  createEntry: (payload) => request('/api/production/entries', json(payload)),

  updateEntry: (id, payload) =>
    request(`/api/production/entries/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteEntry: (id) => request(`/api/production/entries/${id}`, { method: 'DELETE' }),

  /**
   * The one-click marks on a card: `{ status?, priority?, color? }`. Only the
   * keys given are changed. Not version-checked - see the route.
   */
  setEntryMarks: (id, marks) =>
    request(`/api/production/entries/${id}/marks`, json(marks)).then((r) => r.data),

  /**
   * Move a card. Without `mode`, an occupied target rejects with
   * SlotOccupiedError carrying what is already there, so the caller can ask the
   * planner which resolution they want instead of picking one.
   */
  moveEntry: async (id, { productionDate, shiftId, mode }) => {
    const token = getToken();
    const response = await fetch(`/api/production/entries/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productionDate, shiftId, mode })
    });

    if (response.status === 401) {
      redirectToLogin();
      throw new ApiError('Session expired', 401);
    }

    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body.occupants) throw new SlotOccupiedError(body.occupants);
    if (!response.ok) throw new ApiError(body.message || body.error || 'Move failed', response.status);
    return body;
  },

  undo: (payload) => request('/api/production/entries/undo', json(payload)),

  // ------------------------------------------------------- bulk (section 4.5)
  moveDay: (payload) => request('/api/production/bulk/move-day', json(payload)),
  swapDays: (payload) => request('/api/production/bulk/swap-days', json(payload)),
  shiftRange: (payload) => request('/api/production/bulk/shift-range', json(payload)),
  copyDays: (payload) => request('/api/production/bulk/copy', json(payload)),
  splitEntry: (id, payload) => request(`/api/production/entries/${id}/split`, json(payload)),

  /**
   * One page of the log. `before` is the smallest id already seen; `entryId`
   * narrows it to one card, which is what the viewer's "what changed" panel
   * asks for - without it, that panel was answering with the newest change
   * anywhere in the location.
   */
  activity: ({ location, limit = 50, before = null, entryId = null }) =>
    request(
      `/api/production/activity?location=${encodeURIComponent(location)}&limit=${limit}` +
      (before ? `&before=${before}` : '') +
      (entryId ? `&entryId=${entryId}` : '')
    ),

  restoreFromHistory: (logId) =>
    request(`/api/production/activity/${logId}/restore`, { method: 'POST' }).then((r) => r.data),

  /** The note under one shift on one day. Empty text clears it. */
  setShiftNote: ({ location, date, shiftId, note }) =>
    request('/api/production/shift-notes', {
      method: 'PUT',
      body: JSON.stringify({ location, date, shiftId, note })
    }).then((r) => r.data),

  setDayFlag: ({ location, date, flag, note }) =>
    request('/api/production/day-flags', {
      method: 'PUT',
      body: JSON.stringify({ location, date, flag, note })
    }).then((r) => r.data)
};
