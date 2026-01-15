const { Client } = require('@microsoft/microsoft-graph-client');
require('azure-functions-core-tools');
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
          $select: 'id,displayName,mail,userPrincipalName',
          $top: 100,
          $filter: 'accountEnabled eq true'
        }
      });

      return response.data.value.map(user => ({
        id: user.id,
        name: user.displayName,
        email: user.mail || user.userPrincipalName,
        upn: user.userPrincipalName
      }));
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
          $select: 'id,displayName,mail,userPrincipalName',
          $filter: `startswith(displayName,'${query}') or startswith(mail,'${query}')`,
          $top: 20
        }
      });

      return response.data.value.map(user => ({
        id: user.id,
        name: user.displayName,
        email: user.mail || user.userPrincipalName,
        upn: user.userPrincipalName
      }));
    } catch (error) {
      console.error('Error searching users:', error.response?.data || error.message);
      throw new Error('Failed to search users');
    }
  }
}

module.exports = GraphService;
