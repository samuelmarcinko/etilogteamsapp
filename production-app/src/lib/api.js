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

  /** Everything the grid needs for one location over one date range. */
  plan: ({ location, from, to }) =>
    request(`/api/production/plan?location=${encodeURIComponent(location)}&from=${from}&to=${to}`)
      .then((r) => r.data),

  entry: (id) => request(`/api/production/entries/${id}`).then((r) => r.data),

  unscheduled: (location) =>
    request(`/api/production/unscheduled?location=${encodeURIComponent(location)}`).then((r) => r.data),

  searchProducts: (q) =>
    request(`/api/production/products?q=${encodeURIComponent(q)}`).then((r) => r.data),

  createProduct: (fgNumber, description) =>
    request('/api/production/products', json({ fgNumber, description })).then((r) => r.data),

  // ------------------------------------------------------------------ writes
  createEntry: (payload) => request('/api/production/entries', json(payload)),

  updateEntry: (id, payload) =>
    request(`/api/production/entries/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteEntry: (id) => request(`/api/production/entries/${id}`, { method: 'DELETE' }),

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

  activity: (location, limit = 100) =>
    request(`/api/production/activity?location=${encodeURIComponent(location)}&limit=${limit}`)
      .then((r) => r.data),

  restoreFromHistory: (logId) =>
    request(`/api/production/activity/${logId}/restore`, { method: 'POST' }).then((r) => r.data),

  setDayFlag: ({ location, date, flag, note }) =>
    request('/api/production/day-flags', {
      method: 'PUT',
      body: JSON.stringify({ location, date, flag, note })
    }).then((r) => r.data)
};
