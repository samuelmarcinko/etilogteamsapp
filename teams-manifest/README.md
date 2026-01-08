# Teams App Manifest

This directory contains the Microsoft Teams app manifest and related files.

## Files Required

1. **manifest.json** - The app manifest (already included)
2. **color.png** - Color icon (192x192 pixels)
3. **outline.png** - Outline icon (32x32 pixels, transparent background)

## Creating Icons

### Color Icon (color.png)
- Size: 192x192 pixels
- Format: PNG
- Full color icon for your app

### Outline Icon (outline.png)
- Size: 32x32 pixels
- Format: PNG
- Transparent background
- White or black outline only

## Preparing the Manifest

Before packaging, replace the placeholders in `manifest.json`:

1. Replace `{{MICROSOFT_APP_ID}}` with your actual Microsoft App ID
2. Replace `{{APP_DOMAIN}}` with your server domain (e.g., `your-server.com`)

You can use the provided script to do this automatically:

```bash
node ../scripts/prepare-manifest.js
```

## Packaging the App

To create the Teams app package:

1. Place your icon files (color.png and outline.png) in this directory
2. Update the placeholders in manifest.json
3. Zip all three files together:

```bash
zip -r approval-app.zip manifest.json color.png outline.png
```

Or use PowerShell on Windows:
```powershell
Compress-Archive -Path manifest.json, color.png, outline.png -DestinationPath approval-app.zip
```

## Installing in Teams

1. Go to Microsoft Teams Admin Center
2. Navigate to Teams apps > Manage apps
3. Click "Upload" and select your approval-app.zip
4. Approve the app for your organization
5. Users can then add the app from the Teams App Store

## Permissions

This app requires the following permissions:
- **identity**: To access user profile information
- **messageTeamMembers**: To send direct messages to users

These permissions are automatically granted when the app is installed in your tenant.
