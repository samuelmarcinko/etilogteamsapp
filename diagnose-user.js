#!/usr/bin/env node
/**
 * Diagnose why a user is not appearing in lists
 * Usage: node diagnose-user.js dominika.sinaiova@etilog.com
 */

require('dotenv').config();
const GraphService = require('./src/services/graphService');

const email = process.argv[2] || 'dominika.sinaiova@etilog.com';

console.log(`\n🔍 Diagnosing user: ${email}\n`);
console.log('='.repeat(60));

(async () => {
  try {
    const result = await GraphService.diagnoseUser(email);

    if (!result.found) {
      console.log('\n❌ User NOT FOUND in Graph API!');
      console.log('This means the email might be different or the user does not exist.');
      return;
    }

    console.log(`\n✅ Found ${result.rawUsers.length} user(s)\n`);

    for (const analysis of result.analysis) {
      console.log('-'.repeat(60));
      console.log('📋 User Details:');
      console.log(`   ID:                ${analysis.id}`);
      console.log(`   Display Name:      ${analysis.displayName}`);
      console.log(`   Mail:              ${analysis.mail || '⚠️  NULL/EMPTY!'}`);
      console.log(`   UPN:               ${analysis.userPrincipalName}`);
      console.log(`   Given Name:        ${analysis.givenName}`);
      console.log(`   Surname:           ${analysis.surname}`);
      console.log(`   User Type:         ${analysis.userType}`);
      console.log(`   Account Enabled:   ${analysis.accountEnabled}`);
      console.log(`   Has Licenses:      ${analysis.hasLicenses} (count: ${analysis.licenseCount})`);

      console.log('\n🔎 Filter Analysis (why user might be excluded):');
      const checks = analysis.wouldBeIncluded;
      console.log(`   ✓ Has @etilog.com domain: ${checks.hasEtilogDomain ? '✅ YES' : '❌ NO'}`);
      console.log(`   ✓ Has license:            ${checks.hasLicense ? '✅ YES' : '❌ NO'}`);
      console.log(`   ✓ Account enabled:        ${checks.isEnabled ? '✅ YES' : '❌ NO'}`);

      const wouldBeIncluded = checks.hasEtilogDomain && checks.hasLicense && checks.isEnabled;
      console.log(`\n   📊 Would be included in user list: ${wouldBeIncluded ? '✅ YES' : '❌ NO'}`);

      if (!wouldBeIncluded) {
        console.log('\n   ⚠️  ISSUES FOUND:');
        if (!checks.hasEtilogDomain) {
          console.log('      - Email does not end with @etilog.com');
          console.log(`        Mail: "${analysis.mail}", UPN: "${analysis.userPrincipalName}"`);
        }
        if (!checks.hasLicense) {
          console.log('      - No licenses assigned (assignedLicenses is empty in Graph API)');
        }
        if (!checks.isEnabled) {
          console.log('      - Account is disabled');
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Raw Graph API response:');
    console.log(JSON.stringify(result.rawUsers, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
})();
