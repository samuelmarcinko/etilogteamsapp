#!/usr/bin/env node
/**
 * Access-control parity check.
 *
 * Compares the seeded roles/role_permissions matrix against the access rules
 * that are hardcoded in the running portal today. Every role must come out with
 * exactly the same rights it has now, otherwise switching the resolver on would
 * silently grant or remove access.
 *
 * Read-only: issues SELECTs and nothing else, so it is safe to run against
 * production. Exits 0 on full parity, 1 on any mismatch.
 *
 *   npm run check:access-parity
 */

const pool = require('../src/database/config');

// ---------------------------------------------------------------------------
// The rules as they exist today, transcribed from the running code.
// ---------------------------------------------------------------------------

// public/portal/assets/js/portal.js:268-275
function legacyHasModuleAccess(module, role) {
  if (role === 'admin') return true;
  if (module === 'hr') return true;
  if (module === 'fleet') return role === 'admin';
  if (module === 'warehouse') return role === 'sklad' || role === 'sklad_read';
  return false;
}

// public/portal/assets/js/portal.js:281-283
function legacyCanEditWarehouse(role) {
  return role === 'admin' || role === 'sklad';
}

// Server-side gates. Each entry lists the roles requireDbRole(...) accepts.
const LEGACY_ROUTE_GATES = {
  // adminRoutes.js:21-23,48 · quotaRoutes.js:18-20 · sickNoteRoutes.js:52-53
  'hr.manage': ['admin', 'spravca'],
  // warehouseRoutes.js:14
  'warehouse.read': ['admin', 'sklad', 'sklad_read'],
  // warehouseRoutes.js:15
  'warehouse.write': ['admin', 'sklad'],
  // fleetRoutes.js:9
  'fleet.access': ['admin']
};

/**
 * What each permission key should resolve to for a given role, according to the
 * behaviour running in production right now.
 */
function legacyGrants(role) {
  return {
    'hr.access': legacyHasModuleAccess('hr', role),
    'hr.manage': LEGACY_ROUTE_GATES['hr.manage'].includes(role),
    'fleet.access': legacyHasModuleAccess('fleet', role),
    'warehouse.read': legacyHasModuleAccess('warehouse', role),
    'warehouse.write': legacyCanEditWarehouse(role),
    // Production does not exist yet; only admin is meant to hold it.
    'production.view': role === 'admin',
    'production.manage': role === 'admin'
  };
}

const PERMISSION_KEYS = Object.keys(legacyGrants('user'));

// ---------------------------------------------------------------------------
// The same answer, derived from the database.
// ---------------------------------------------------------------------------

/**
 * Mirrors the resolver the app will use: admin holds everything, everyone else
 * gets hr.access plus whatever the matrix grants their role.
 */
function resolveFromMatrix(role, matrix) {
  const granted = new Set(['hr.access']);
  if (role === 'admin') {
    PERMISSION_KEYS.forEach((k) => granted.add(k));
    return granted;
  }
  (matrix[role] || []).forEach((k) => granted.add(k));
  return granted;
}

// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

let failures = 0;

function report(ok, message) {
  if (ok) {
    console.log(`  ${GREEN}OK${OFF}   ${message}`);
  } else {
    console.log(`  ${RED}FAIL${OFF} ${message}`);
    failures += 1;
  }
}

async function main() {
  const { rows: tableRows } = await pool.query(
    "SELECT to_regclass('public.roles') AS roles, to_regclass('public.role_permissions') AS perms"
  );
  if (!tableRows[0].roles || !tableRows[0].perms) {
    console.error(
      `${RED}Migration 024 has not been applied - roles/role_permissions are missing.${OFF}`
    );
    process.exitCode = 1;
    return;
  }

  const { rows: roleRows } = await pool.query(
    'SELECT id, name, label, is_system FROM roles ORDER BY id'
  );
  const { rows: permRows } = await pool.query(
    `SELECT r.name AS role_name, rp.permission_key
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id`
  );

  const matrix = {};
  for (const row of permRows) {
    (matrix[row.role_name] = matrix[row.role_name] || []).push(row.permission_key);
  }

  // --- 1. the five roles that exist today are present and locked -----------
  console.log('\nSystem roles');
  const EXPECTED_SYSTEM = ['user', 'spravca', 'sklad', 'sklad_read', 'admin'];
  for (const name of EXPECTED_SYSTEM) {
    const role = roleRows.find((r) => r.name === name);
    report(!!role, `role "${name}" exists`);
    if (role) report(role.is_system === true, `role "${name}" is locked as a system role`);
  }

  // --- 2. permission matrix reproduces today's access ----------------------
  console.log('\nPermission parity');
  const allRoles = roleRows.map((r) => r.name);
  for (const role of allRoles) {
    const expected = legacyGrants(role);
    const actual = resolveFromMatrix(role, matrix);
    const wrong = PERMISSION_KEYS.filter((key) => expected[key] !== actual.has(key));

    if (wrong.length === 0) {
      const held = PERMISSION_KEYS.filter((k) => actual.has(k));
      report(true, `${role.padEnd(11)} ${DIM}${held.join(', ') || '(none)'}${OFF}`);
    } else {
      for (const key of wrong) {
        report(
          false,
          `${role.padEnd(11)} ${key}: matrix says ${actual.has(key)}, portal grants ${expected[key]}`
        );
      }
    }
  }

  // --- 3. HR can never be switched off ------------------------------------
  console.log('\nHR is always on');
  for (const role of allRoles) {
    report(resolveFromMatrix(role, matrix).has('hr.access'), `${role} keeps hr.access`);
  }

  // --- 4. every users.role value maps to a known role ----------------------
  console.log('\nUsers vs roles');
  const { rows: userRoles } = await pool.query(
    `SELECT COALESCE(role, '(null)') AS role, count(*)::int AS count
       FROM users GROUP BY 1 ORDER BY 2 DESC`
  );
  const known = new Set(allRoles);
  for (const row of userRoles) {
    const isKnown = known.has(row.role);
    if (isKnown) {
      report(true, `${row.role.padEnd(11)} ${row.count} user(s)`);
    } else {
      // Not fatal: the resolver falls back to hr.access only, which is exactly
      // what the portal gives an unrecognised role today. Worth surfacing.
      console.log(
        `  ${DIM}note${OFF} ${row.role.padEnd(11)} ${row.count} user(s) - no matching role row; ` +
        'resolves to hr.access only, same as today'
      );
    }
  }

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}Parity confirmed${OFF} - the matrix grants exactly what the portal grants today.\n`);
  } else {
    console.log(`${RED}${failures} mismatch(es)${OFF} - do not switch the resolver on.\n`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`${RED}Parity check failed to run:${OFF} ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
