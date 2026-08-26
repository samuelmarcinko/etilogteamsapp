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

export const api = {
  /** Current user, including permissions[] and accessControlMode. */
  me: () => request('/api/admin/me').then((r) => r.data),

  locations: () => request('/api/production/locations').then((r) => r.data),

  /** Everything the grid needs for one location over one date range. */
  plan: ({ location, from, to }) =>
    request(`/api/production/plan?location=${encodeURIComponent(location)}&from=${from}&to=${to}`)
      .then((r) => r.data),

  entry: (id) => request(`/api/production/entries/${id}`).then((r) => r.data)
};
