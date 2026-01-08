const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Script to prepare Teams manifest by replacing placeholders
 */
function prepareManifest() {
  const manifestPath = path.join(__dirname, '../teams-manifest/manifest.json');
  const outputPath = path.join(__dirname, '../teams-manifest/manifest.generated.json');

  // Read manifest template
  let manifest = fs.readFileSync(manifestPath, 'utf8');

  // Replace placeholders
  const replacements = {
    '{{MICROSOFT_APP_ID}}': process.env.MICROSOFT_APP_ID || 'YOUR_APP_ID',
    '{{APP_DOMAIN}}': process.env.APP_BASE_URL?.replace('https://', '').replace('http://', '') || 'your-server.com'
  };

  Object.entries(replacements).forEach(([placeholder, value]) => {
    manifest = manifest.replace(new RegExp(placeholder, 'g'), value);
  });

  // Write generated manifest
  fs.writeFileSync(outputPath, manifest);

  console.log('✅ Manifest prepared successfully!');
  console.log(`📄 Generated manifest: ${outputPath}`);
  console.log('\nPlease review the generated manifest and then:');
  console.log('1. Add your icon files (color.png and outline.png) to teams-manifest/');
  console.log('2. Create a zip file with manifest.generated.json, color.png, and outline.png');
  console.log('3. Upload the zip file to Teams Admin Center');
}

if (require.main === module) {
  prepareManifest();
}

module.exports = prepareManifest;
