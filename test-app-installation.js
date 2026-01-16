require('dotenv').config();
const axios = require('axios');

async function checkAppInstallation() {
  try {
    // Get access token
    const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', process.env.MICROSOFT_APP_ID);
    params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const tokenResponse = await axios.post(tokenEndpoint, params);
    const accessToken = tokenResponse.data.access_token;

    // Check installed apps for user
    const userId = '66c5f5e3-f5e3-4599-8ab5-62ac036d4430'; // Samuel Marcinko
    const teamsAppId = process.env.TEAMS_APP_ID;

    console.log('Checking installed apps for user:', userId);
    console.log('Looking for Teams App ID:', teamsAppId);
    console.log('---');

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${userId}/teamwork/installedApps?$expand=teamsAppDefinition`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    console.log('Total installed apps:', response.data.value.length);
    console.log('---');

    const ourApp = response.data.value.find(app =>
      app.teamsAppDefinition?.teamsAppId === teamsAppId
    );

    if (ourApp) {
      console.log('✅ App IS installed for user!');
      console.log('Installation ID:', ourApp.id);
      console.log('App Display Name:', ourApp.teamsAppDefinition?.displayName);
      console.log('App Version:', ourApp.teamsAppDefinition?.version);
    } else {
      console.log('❌ App NOT installed for user!');
      console.log('---');
      console.log('Installed apps:');
      response.data.value.forEach(app => {
        console.log(`- ${app.teamsAppDefinition?.displayName} (${app.teamsAppDefinition?.teamsAppId})`);
      });
    }

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkAppInstallation();
