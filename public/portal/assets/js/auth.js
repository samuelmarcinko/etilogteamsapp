/**
 * MSAL Authentication for ETILOG Portal
 */
let msalInstance = null;
let currentAccount = null;
let msalInitPromise = null;

/**
 * Initialize MSAL (idempotent — safe to call from both auth.js and portal.js;
 * the actual init runs once and every caller awaits the same promise).
 */
function initializeMsal() {
    if (msalInitPromise) return msalInitPromise;
    msalInitPromise = (async () => {
        try {
            // If an already-authenticated user lands on the login page with a valid
            // (non-expired) token, skip the login screen and go straight to the portal.
            const onLoginPage = window.location.pathname === '/login' || window.location.pathname === '/login/';
            if (onLoginPage) {
                const stored = localStorage.getItem('etilog_token');
                if (stored) {
                    try {
                        const payload = JSON.parse(atob(stored.split('.')[1]));
                        if (payload.exp * 1000 > Date.now() + 60 * 1000) {
                            window.location.href = '/portal/';
                            return;
                        }
                    } catch (e) {
                        // Invalid token format - fall through to normal login flow
                    }
                }
            }

            await loadAuthConfig();
            msalInstance = new msal.PublicClientApplication(msalConfig);
            await msalInstance.initialize();

            // Handle redirect response (returning from the Microsoft sign-in redirect)
            const response = await msalInstance.handleRedirectPromise();
            if (response) {
                currentAccount = response.account;
                handleLoginSuccess(response);
                return;
            }

            // Check for existing session - just set currentAccount for token renewal
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                currentAccount = accounts[0];
            }
        } catch (error) {
            console.error('MSAL initialization error:', error);
        }
    })();
    return msalInitPromise;
}

/**
 * Sign in with Microsoft
 */
async function signIn() {
    // Priebeh a chyby ukazuje prihlasovacia stránka vlastnými prvkami. Ak by
    // niektorý chýbal, prihlásenie sa aj tak musí pokúsiť prebehnúť - stav na
    // obrazovke nie je dôvod nepustiť človeka dnu.
    const busy = document.getElementById('authBusy');
    const msBtn = document.getElementById('msBtn');
    const passwordBlock = document.getElementById('authPasswordBlock');
    const hadPasswordForm = passwordBlock && !passwordBlock.hidden;

    const showProgress = (on) => {
        if (busy) busy.hidden = !on;
        if (msBtn) msBtn.hidden = on;
        if (hadPasswordForm) passwordBlock.hidden = on;
    };

    try {
        if (typeof authClearError === 'function') authClearError();
        showProgress(true);

        if (!msalInstance) {
            await initializeMsal();
        }

        // Redirect flow (not popup): reliable on tablets/mobile and avoids the
        // "block_nested_popups" error that popup + full-SPA redirectUri caused.
        // The browser leaves this page and returns to redirectUri, where
        // handleRedirectPromise() (in initializeMsal) completes the sign-in.
        await msalInstance.loginRedirect(loginRequest);
    } catch (error) {
        console.error('Login error:', error);
        showProgress(false);
        // Hláška ide cez tie isté preložené kľúče ako prihlásenie heslom;
        // technickú správu z MSAL-u si prečíta vývojár v konzole, nie človek,
        // ktorý sa chce dostať do portálu.
        if (typeof authShowError === 'function') authShowError('microsoft');
    }
}

/**
 * Handle successful login
 */
function handleLoginSuccess(response) {
    // Use ID token for our own backend API (audience = our client ID)
    const token = response.idToken;
    if (!token) {
        console.error('No ID token received');
        return;
    }
    localStorage.setItem('etilog_token', token);
    localStorage.setItem('etilog_account', JSON.stringify(response.account));

    // Only redirect if we're on the login page - don't redirect if already on portal
    if (window.location.pathname === '/login' || window.location.pathname === '/login/') {
        window.location.href = '/portal/';
    }
}

/**
 * Sign out
 */
async function signOut() {
    // Kto sa prihlásil heslom, nemá u Microsoftu čo odhlasovať - a volanie
    // logoutPopup by mu otvorilo okno Microsoftu, ktoré nikdy nevidel.
    const wasLocal = localStorage.getItem('etilog_auth') === 'local';

    localStorage.removeItem('etilog_token');
    localStorage.removeItem('etilog_account');
    localStorage.removeItem('etilog_user');
    localStorage.removeItem('etilog_auth');

    if (wasLocal) {
        window.location.href = '/login';
        return;
    }

    if (msalInstance) {
        try {
            await msalInstance.logoutPopup({
                postLogoutRedirectUri: window.location.origin + '/login'
            });
        } catch (e) {
            window.location.href = '/login';
        }
    } else {
        window.location.href = '/login';
    }
}

/**
 * Get ID token for our backend API calls
 */
async function getAccessToken() {
    // First try stored token
    const stored = localStorage.getItem('etilog_token');
    if (stored) {
        // Check if token is expired (with 60 second buffer to prevent edge-case expiration during request)
        try {
            const payload = JSON.parse(atob(stored.split('.')[1]));
            const bufferMs = 60 * 1000; // 60 second buffer
            if (payload.exp * 1000 > Date.now() + bufferMs) {
                return stored;
            }
            // Token expired or about to expire, remove it and get fresh token
            localStorage.removeItem('etilog_token');
        } catch (e) {
            // Invalid token format
            localStorage.removeItem('etilog_token');
        }
    }

    // Prihlásený heslom a token vypršal: u Microsoftu preň nič nie je, tak
    // rovno späť na prihlásenie. Bez tohto by sa MSAL pokúšal obnoviť reláciu,
    // ktorá nikdy neexistovala.
    if (localStorage.getItem('etilog_auth') === 'local') {
        localStorage.removeItem('etilog_auth');
        window.location.href = '/login';
        return null;
    }

    // Try to reinitialize MSAL if needed
    if (!msalInstance) {
        try {
            await initializeMsal();
        } catch (e) {
            console.error('Failed to reinitialize MSAL:', e);
        }
    }

    // If still no msalInstance or account, try to get account from MSAL
    if (msalInstance && !currentAccount) {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            currentAccount = accounts[0];
        }
    }

    if (!msalInstance || !currentAccount) {
        window.location.href = '/login';
        return null;
    }

    try {
        const response = await msalInstance.acquireTokenSilent({
            ...loginRequest,
            account: currentAccount
        });
        // Use ID token for our backend
        const token = response.idToken;
        localStorage.setItem('etilog_token', token);
        return token;
    } catch (e) {
        console.error('Token acquisition failed:', e);
        window.location.href = '/login';
        return null;
    }
}

/**
 * Make authenticated API call
 */
async function apiCall(url, options = {}) {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
        }
    });

    return response;
}

/**
 * Check if user is logged in
 */
function isLoggedIn() {
    return !!localStorage.getItem('etilog_token');
}

/**
 * Get stored account info
 */
function getStoredAccount() {
    try {
        return JSON.parse(localStorage.getItem('etilog_account'));
    } catch {
        return null;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initializeMsal);
