/**
 * MSAL Configuration for ETILOG Portal
 * Uses Azure AD single-tenant auth
 */
const msalConfig = {
    auth: {
        clientId: window.ETILOG_CLIENT_ID || '', // Will be set from config endpoint
        authority: 'https://login.microsoftonline.com/68fad620-da38-42f1-bff7-f02d56a8b293',
        redirectUri: window.location.origin + '/portal/',
        postLogoutRedirectUri: window.location.origin + '/login'
    },
    cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
    }
};

const loginRequest = {
    scopes: ['User.Read', 'openid', 'profile', 'email']
};

const tokenRequest = {
    scopes: ['api://' + (window.ETILOG_CLIENT_ID || '') + '/access_as_user'],
    forceRefresh: false
};

// Fetch client ID from server config
async function loadAuthConfig() {
    try {
        const response = await fetch('/api/auth/config');
        if (response.ok) {
            const config = await response.json();
            msalConfig.auth.clientId = config.clientId;
            tokenRequest.scopes = ['api://' + config.clientId + '/access_as_user'];
            return config;
        }
    } catch (e) {
        console.warn('Could not load auth config from server, using defaults');
    }
    return null;
}
