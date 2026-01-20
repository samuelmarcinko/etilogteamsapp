const axios = require('axios');
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
      console.error('Error getting access token:', error.response?.data || error.message);
      throw new Error('Failed to get access token');
    }
  }

  /**
   * Get all users from Azure AD
   */
  static async getUsers() {
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get('https://graph.microsoft.com/v1.0/users', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          $select: 'id,displayName,mail,userPrincipalName,userType,assignedLicenses',
          $top: 999,
          // Basic filter - we'll filter domain and licenses on backend
          $filter: "accountEnabled eq true and userType eq 'Member'"
        }
      });

      // Filter for @etilog.com domain and users with licenses
      const etilogUsers = response.data.value.filter(user => {
        const email = user.mail || user.userPrincipalName || '';
        const hasEtilogDomain = email.toLowerCase().endsWith('@etilog.com');
        const hasLicense = user.assignedLicenses && user.assignedLicenses.length > 0;

        return hasEtilogDomain && hasLicense;
      });

      // Map and format users: "Priezvisko Meno <email>"
      const formattedUsers = etilogUsers.map(user => {
        const email = user.mail || user.userPrincipalName;
        const displayName = user.displayName || '';

        // Split name into parts (assume "FirstName LastName" format)
        const nameParts = displayName.trim().split(/\s+/);
        let formattedName;

        if (nameParts.length >= 2) {
          // Last word is surname, everything else is first name
          const lastName = nameParts[nameParts.length - 1];
          const firstName = nameParts.slice(0, -1).join(' ');
          formattedName = `${lastName} ${firstName}`;
        } else {
          // Single name, use as-is
          formattedName = displayName;
        }

        return {
          id: user.id,
          name: formattedName,
          email: email,
          upn: user.userPrincipalName,
          lastName: nameParts.length >= 2 ? nameParts[nameParts.length - 1] : displayName
        };
      });

      // Sort alphabetically by last name
      formattedUsers.sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk'));

      // Remove lastName from final output (was only for sorting)
      return formattedUsers.map(({ lastName, ...user }) => user);
    } catch (error) {
      console.error('Error fetching users:', error.response?.data || error.message);
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
      console.error('Error fetching user:', error.response?.data || error.message);
      throw new Error('Failed to fetch user from Microsoft Graph');
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
          // Basic filter with search - we'll filter domain and licenses on backend
          $filter: `accountEnabled eq true and userType eq 'Member' and (startswith(displayName,'${query}') or startswith(mail,'${query}'))`,
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

      // Map and format users: "Priezvisko Meno <email>"
      const formattedUsers = etilogUsers.map(user => {
        const email = user.mail || user.userPrincipalName;
        const displayName = user.displayName || '';

        // Split name into parts (assume "FirstName LastName" format)
        const nameParts = displayName.trim().split(/\s+/);
        let formattedName;

        if (nameParts.length >= 2) {
          // Last word is surname, everything else is first name
          const lastName = nameParts[nameParts.length - 1];
          const firstName = nameParts.slice(0, -1).join(' ');
          formattedName = `${lastName} ${firstName}`;
        } else {
          // Single name, use as-is
          formattedName = displayName;
        }

        return {
          id: user.id,
          name: formattedName,
          email: email,
          upn: user.userPrincipalName,
          lastName: nameParts.length >= 2 ? nameParts[nameParts.length - 1] : displayName
        };
      });

      // Sort alphabetically by last name
      formattedUsers.sort((a, b) => a.lastName.localeCompare(b.lastName, 'sk'));

      // Return top 20, remove lastName from final output
      return formattedUsers.slice(0, 20).map(({ lastName, ...user }) => user);
    } catch (error) {
      console.error('Error searching users:', error.response?.data || error.message);
      throw new Error('Failed to search users');
    }
  }
}

module.exports = GraphService;
