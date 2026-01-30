/**
 * MSAL Authentication for ETILOG Portal
 */
let msalInstance = null;
let currentAccount = null;

/**
 * Initialize MSAL
 */
async function initializeMsal() {
    try {
        await loadAuthConfig();
        msalInstance = new msal.PublicClientApplication(msalConfig);
        await msalInstance.initialize();

        // Handle redirect response
        const response = await msalInstance.handleRedirectPromise();
        if (response) {
            currentAccount = response.account;
            handleLoginSuccess(response);
            return;
        }

        // Check for existing session
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            currentAccount = accounts[0];
            // Try to get token silently
            try {
                const tokenResponse = await msalInstance.acquireTokenSilent({
                    ...loginRequest,
                    account: currentAccount
                });
                handleLoginSuccess(tokenResponse);
            } catch (e) {
                // Silent token failed - user needs to re-login
                console.log('Silent token acquisition failed, user needs to sign in');
            }
        }
    } catch (error) {
        console.error('MSAL initialization error:', error);
    }
}

/**
 * Sign in with Microsoft
 */
async function signIn() {
    const loginBtn = document.getElementById('loginBtn');
    const loginContent = document.getElementById('loginContent');
    const loginLoading = document.getElementById('loginLoading');
    const loginError = document.getElementById('loginError');

    try {
        loginContent.style.display = 'none';
        loginLoading.style.display = 'block';
        loginError.style.display = 'none';

        if (!msalInstance) {
            await initializeMsal();
        }

        const response = await msalInstance.loginPopup(loginRequest);
        currentAccount = response.account;
        handleLoginSuccess(response);
    } catch (error) {
        console.error('Login error:', error);
        loginContent.style.display = 'block';
        loginLoading.style.display = 'none';
        loginError.style.display = 'block';
        loginError.textContent = 'Prihlasenie zlyhalo: ' + (error.message || 'Neznama chyba');
    }
}

/**
 * Handle successful login
 */
function handleLoginSuccess(response) {
    // Use ID token for our own backend API (audience = our client ID)
    // Access token is for Microsoft Graph (audience = graph.microsoft.com) - don't use for our API
    const token = response.idToken;
    if (!token) {
        console.error('No ID token received');
        return;
    }
    localStorage.setItem('etilog_token', token);
    localStorage.setItem('etilog_account', JSON.stringify(response.account));

    // Redirect to portal
    window.location.href = '/portal/';
}

/**
 * Sign out
 */
async function signOut() {
    localStorage.removeItem('etilog_token');
    localStorage.removeItem('etilog_account');
    localStorage.removeItem('etilog_user');

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
        // Check if token is expired
        try {
            const payload = JSON.parse(atob(stored.split('.')[1]));
            if (payload.exp * 1000 > Date.now()) {
                return stored;
            }
            // Token expired, remove it
            localStorage.removeItem('etilog_token');
        } catch (e) {
            // Invalid token format
            localStorage.removeItem('etilog_token');
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
