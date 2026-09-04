#!/usr/bin/env node
/**
 * Boot smoke test.
 *
 * Starts the real Express app and checks that the pages and endpoints the
 * portal cannot live without still answer. Run it before every deploy:
 *
 *   npm run smoke
 *
 * This exists because a route file once called a middleware it had not
 * imported. Nothing failed until Node loaded that module at startup, the
 * process died, and Traefik - with no healthy container behind it - answered
 * every request to portal.etilog.com with 404. Unit-testing the middleware did
 * not catch it, because no test ever loaded the route files.
 *
 * Needs no real Azure credentials or database: dummy values are enough to get
 * the app listening, which is all this checks.
 */

const http = require('http');

// Dummy config so the bot adapter constructs. Set before requiring the app.
process.env.MICROSOFT_APP_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.MICROSOFT_APP_PASSWORD ||= 'smoke-test';
process.env.TENANT_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.CLIENT_ID ||= process.env.MICROSOFT_APP_ID;
process.env.LOG_LEVEL ||= 'error';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

// path, expected status, why it matters
const CHECKS = [
  ['/health', 200, 'container healthcheck - Traefik drops the route without it'],
  ['/login', 200, 'portal login page'],
  ['/portal/', 200, 'portal SPA shell'],
  ['/api/health', 200, 'API health'],
  ['/api/auth/config', 200, 'MSAL config the login page fetches'],
  ['/api/admin/me', 401, 'protected route rejects an unauthenticated caller'],
  ['/api/warehouse/stats', 401, 'warehouse routes load and are protected'],
  ['/api/fleet', 401, 'fleet routes load and are protected'],
  ['/api/quotas/all', 401, 'quota routes load and are protected'],
  ['/api/sick-notes/all', 401, 'sick note routes load and are protected'],
  ['/api/production/locations', 401, 'production routes load and are protected'],
  // Mounted before /production, so a 401 here also proves it is not being
  // swallowed by the production router first.
  ['/api/production/sap/projects', 401, 'SAP routes load and are protected'],
  ['/api/production/changes', 401, 'the publish summary loads and is protected'],
  ['/api/production/discard/preview', 401, 'the discard preview loads and is protected'],
  ['/production/', 200, 'production SPA shell']
];

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 8000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

async function main() {
  let app;
  try {
    // Loading the app is itself the most important assertion: every route file
    // is required here, so a missing import fails now rather than on the VPS.
    app = require('../src/index');
  } catch (error) {
    console.error(`\n${RED}The app failed to load.${OFF} This is what takes the portal down.\n`);
    console.error(error);
    process.exitCode = 1;
    return;
  }

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve).on('error', reject);
  });
  const { port } = server.address();

  let failures = 0;
  console.log('');
  for (const [path, expected, why] of CHECKS) {
    let status;
    try {
      status = await get(port, path);
    } catch (error) {
      status = `error: ${error.message}`;
    }

    if (status === expected) {
      console.log(`  ${GREEN}OK${OFF}   ${String(expected).padEnd(4)} ${path.padEnd(24)} ${DIM}${why}${OFF}`);
    } else {
      console.log(`  ${RED}FAIL${OFF} ${path.padEnd(24)} expected ${expected}, got ${status}`);
      failures += 1;
    }
  }

  server.close();

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}Smoke test passed${OFF} - the app boots and its routes answer.\n`);
  } else {
    console.log(`${RED}${failures} check(s) failed${OFF} - do not deploy.\n`);
    process.exitCode = 1;
  }

  // The app starts cron services and a pg pool that would keep the process
  // alive; this is a check, not a server.
  setImmediate(() => process.exit(process.exitCode || 0));
}

main();
