const axios = require('axios');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Microsoft Graph API Service
 * Handles communication with Microsoft Graph API for user data
 */
class GraphService {
  /**
   * Get access token for Microsoft Graph API (app-only auth)
   */
  static async getAccessToken() {
    try {
      const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

      const params = new URLSearchParams();
      params.append('client_id', process.env.MICROSOFT_APP_ID);
      params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
      params.append('scope', 'https://graph.microsoft.com/.default');
      params.append('grant_type', 'client_credentials');

      const response = await axios.post(tokenEndpoint, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return response.data.access_token;
    } catch (error) {
      logger.error('Error getting access token', { error: error.response?.data || error.message });
      throw new Error('Failed to get access token');
    }
  }

  /**
   * Fetch all pages of users from Graph API (handles pagination)
   */
  static async fetchAllUsers(accessToken, params) {
    let allUsers = [];
    let url = 'https://graph.microsoft.com/v1.0/users';

    while (url) {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: url.includes('$skip') ? undefined : params
      });

      allUsers = allUsers.concat(response.data.value || []);
      url = response.data['@odata.nextLink'] || null;
    }

    return allUsers;
  }

  /**
   * Format user name as "LastName FirstName" and return user object
   */
  static formatUser(user) {
    const email = user.mail || user.userPrincipalName;
    const displayName = user.displayName || '';
    const nameParts = displayName.trim().split(/\s+/);
    let formattedName;

    if (nameParts.length >= 2) {
      const lastName = nameParts[nameParts.length - 1];
      const firstName = nameParts.slice(0, -1).join(' ');
      formattedName = `${lastName} ${firstName}`;
    } else {
      formattedName = displayName;
    }

    return {
      id: user.id,
      name: formattedName,
      email: email,
      upn: user.userPrincipalName,
      lastName: nameParts.length >= 2 ? nameParts[nameParts.length - 1] : displayName
    };
  }

  /**
   * Get all users from Azure AD
   */
  static async getUsers() {
    try {
      const accessToken = await this.getAccessToken();

      const allUsers = await this.fetchAllUsers(accessToken, {
        $select: 'id,displayName,mail,userPrincipalName,userType,assignedLicenses',
        $top: 999,
        $filter: "accountEnabled eq true"
      });

      logger.debug('Graph API returned users', { total: allUsers.length });

      // Filter for @etilog.com domain and users with licenses
      const etilogUsers = allUsers.filter(user => {
        const email = user.mail || user.userPrincipalName || '';
        const hasEtilogDomain = email.toLowerCase().endsWith('@etilog.com');
        const hasLicense = user.assignedLicenses && user.assignedLicenses.length > 0;

        if (hasEtilogDomain && !hasLicense) {
          logger.debug('User excluded (no license)', { name: user.displayName, email });
        }

        return hasEtilogDomain && hasLicense;
      });

      logger.debug('Filtered etilog.com users with licenses', { count: etilogUsers.length });

      // Format and sort users
      const formattedUsers = etilogUsers.map(user => this.formatUser(user));
      formattedUsers.sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk'));

      // Remove lastName from final output (was only for sorting)
      return formattedUsers.map(({ lastName, ...user }) => user);
    } catch (error) {
      logger.error('Error fetching users', { error: error.response?.data || error.message });
      throw new Error('Failed to fetch users from Microsoft Graph');
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId) {
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get(`https://graph.microsoft.com/v1.0/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          $select: 'id,displayName,mail,userPrincipalName'
        }
      });

      const user = response.data;
      return {
        id: user.id,
        name: user.displayName,
        email: user.mail || user.userPrincipalName,
        upn: user.userPrincipalName
      };
    } catch (error) {
      logger.error('Error fetching user', { error: error.response?.data || error.message });
      throw new Error('Failed to fetch user from Microsoft Graph');
    }
  }

  /**
   * Get all users including those without licenses (for admin diagnostics)
   */
  static async getAllUsersIncludingUnlicensed() {
    try {
      const accessToken = await this.getAccessToken();

      const allUsers = await this.fetchAllUsers(accessToken, {
        $select: 'id,displayName,mail,userPrincipalName,userType,assignedLicenses,accountEnabled',
        $top: 999,
        $filter: "accountEnabled eq true"
      });

      logger.debug('Graph API returned all users', { total: allUsers.length });

      // Filter for @etilog.com domain only (include users without licenses)
      const etilogUsers = allUsers.filter(user => {
        const email = user.mail || user.userPrincipalName || '';
        return email.toLowerCase().endsWith('@etilog.com');
      });

      logger.debug('Filtered etilog.com users (all)', { count: etilogUsers.length });

      // Format users and include license status
      const formattedUsers = etilogUsers.map(user => {
        const formatted = this.formatUser(user);
        const hasLicense = user.assignedLicenses && user.assignedLicenses.length > 0;
        return {
          ...formatted,
          hasLicense,
          licenseCount: user.assignedLicenses ? user.assignedLicenses.length : 0
        };
      });

      formattedUsers.sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk'));

      // Remove lastName from final output
      return formattedUsers.map(({ lastName, ...user }) => user);
    } catch (error) {
      logger.error('Error fetching all users', { error: error.response?.data || error.message });
      throw new Error('Failed to fetch all users from Microsoft Graph');
    }
  }

  /**
   * Search users by name or email
   */
  static async searchUsers(query) {
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get('https://graph.microsoft.com/v1.0/users', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          $select: 'id,displayName,mail,userPrincipalName,userType,assignedLicenses',
          $filter: `accountEnabled eq true and (startswith(displayName,'${query}') or startswith(mail,'${query}'))`,
          $top: 50
        }
      });

      // Filter for @etilog.com domain and users with licenses
      const etilogUsers = response.data.value.filter(user => {
        const email = user.mail || user.userPrincipalName || '';
        const hasEtilogDomain = email.toLowerCase().endsWith('@etilog.com');
        const hasLicense = user.assignedLicenses && user.assignedLicenses.length > 0;

        return hasEtilogDomain && hasLicense;
      });

      // Format and sort users
      const formattedUsers = etilogUsers.map(user => this.formatUser(user));
      formattedUsers.sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk'));

      // Return top 20, remove lastName from final output
      return formattedUsers.slice(0, 20).map(({ lastName, ...user }) => user);
    } catch (error) {
      logger.error('Error searching users', { error: error.response?.data || error.message });
      throw new Error('Failed to search users');
    }
  }
}

module.exports = GraphService;
