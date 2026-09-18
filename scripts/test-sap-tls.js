#!/usr/bin/env node
/**
 * Spojenie do SAPu: odtlačok a poslucháči.
 *
 *   node scripts/test-sap-tls.js
 *
 * Klient drží spojenie otvorené (`keepAlive`), takže celá synchronizácia ide
 * po jednom sockete. Kontrola odtlačku certifikátu sa ale vešala na každú
 * požiadavku zvlášť - na ten istý socket. Poslucháči sa kopili, Node to hlásil
 * ako `MaxListenersExceededWarning` a log sa tým plnil pri každom behu.
 *
 * Tento test to skúša tak, ako to nastáva v prevádzke: postaví sa skutočný
 * TLS server s vlastným certifikátom, klient sa naň pustí pätnásťkrát a
 * sleduje sa, či Node na niečo upozorní. Prah poslucháčov sa naschvál zníži -
 * s pôvodnou chybou to spadne po štvrtej požiadavke.
 *
 * A hneď za tým to podstatnejšie: že sa tou opravou kontrola odtlačku
 * nestratila. Pri nesprávnom odtlačku musí spojenie skončiť chybou, inak by
 * sme si namiesto tichého logu kúpili dieru. Bude to aktuálne, až keď Softip
 * certifikát vymení - vtedy sa odtlačok zmení a toto je to jediné, čo dnes
 * server overuje.
 *
 * Do SAPu sa pritom nesiaha - server v tomto teste je náš vlastný, na
 * localhoste.
 */

const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const CALLS = 15;

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ${GREEN}OK${OFF}   ${label}`);
  } else {
    console.log(`  ${RED}FAIL${OFF} ${label}${detail ? ` - ${detail}` : ''}`);
    failures += 1;
  }
}

/** Vlastný certifikát na jedno použitie; zahodí sa na konci. */
function makeCert(dir) {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', path.join(dir, 'key.pem'),
    '-out', path.join(dir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1'
  ], { stdio: 'ignore' });

  const cert = fs.readFileSync(path.join(dir, 'cert.pem'));
  return {
    cert,
    key: fs.readFileSync(path.join(dir, 'key.pem')),
    fingerprint: new crypto.X509Certificate(cert).fingerprint256
  };
}

/** Toľko zo SAP Service Layera, koľko klient na ceste k dátam potrebuje. */
function startServer({ cert, key }) {
  const server = https.createServer({ cert, key }, (req, res) => {
    if (req.url.endsWith('/Login')) {
      req.resume();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': ['B1SESSION=test-session; path=/', 'ROUTEID=.node1; path=/']
      });
      res.end(JSON.stringify({ SessionId: 'test-session' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: [] }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function sapEnv(port, fingerprint) {
  return {
    SAP_ENABLED: 'true',
    SAP_HOST: '127.0.0.1',
    SAP_PORT: String(port),
    SAP_DB: 'TESTDB',
    SAP_USER: 'test',
    SAP_PASSWORD: 'test',
    SAP_FINGERPRINT: fingerprint,
    SAP_VERIFY_TLS: 'false',
    LOG_LEVEL: 'error'
  };
}

/**
 * Nesprávny odtlačok musí spojenie zabiť.
 *
 * Beží to v samostatnom procese naschvál: klient si nastavenia prečíta raz pri
 * načítaní modulu, takže inak sa v jednom behu dva rôzne odtlačky vyskúšať
 * nedajú - a skúšať len ten správny by neoveril nič.
 */
function rejectsWrongFingerprint(port) {
  const wrong = 'AA:'.repeat(31) + 'AA';
  // `spawn`, nie `spawnSync`: server beží v tomto procese a synchrónny variant
  // by zablokoval jeho slučku udalostí. Dieťa by sa spojilo na úrovni TCP,
  // handshake by nemal kto obslúžiť a oba procesy by čakali na seba.
  const child = spawn(process.execPath, ['-e', `
    const { SapClient } = require('${path.join(__dirname, '..', 'src', 'services', 'sapClient')}');
    new SapClient().get('/Items').then(
      () => { console.log('PRESLO'); process.exit(0); },
      (error) => { console.log('ODMIETNUTE: ' + error.message); process.exit(0); }
    );
  `], {
    env: { ...process.env, ...sapEnv(port, wrong) },
    timeout: 20000
  });

  return new Promise((resolve) => {
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', () => resolve(output));
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-tls-'));
  const material = makeCert(dir);
  const { server, port } = await startServer(material);

  console.log('');
  console.log(`${DIM}  vlastný TLS server na 127.0.0.1:${port}, ${CALLS} požiadaviek po jednom spojení${OFF}`);
  console.log('');

  // Prah sa zníži, aby sa pôvodná chyba prejavila hneď a nie až pri jedenástej
  // požiadavke. Sleduje sa len upozornenie, ktoré sa týka `secureConnect`;
  // ostatné emitory v procese nás nezaujímajú.
  const warnings = [];
  process.on('warning', (warning) => {
    if (String(warning.message).includes('secureConnect')) warnings.push(warning.message);
  });
  require('events').EventEmitter.defaultMaxListeners = 3;

  Object.assign(process.env, sapEnv(port, material.fingerprint));
  const { SapClient } = require('../src/services/sapClient');
  const client = new SapClient();

  let calls = 0;
  let failure = null;
  for (let i = 0; i < CALLS; i += 1) {
    try {
      await client.get('/Items');
      calls += 1;
    } catch (error) {
      failure = error.message;
      break;
    }
  }

  // Upozornenia chodia cez `process.nextTick`, takže sa na ne musí počkať.
  await new Promise((resolve) => setImmediate(resolve));

  check(`${CALLS} požiadaviek prešlo`, calls === CALLS, failure || `prešlo ${calls}`);
  check('Node neupozornil na hromadenie poslucháčov', warnings.length === 0, warnings[0]);

  await client.logout();

  console.log('');
  // Server musí ešte bežať: klient sa naň potrebuje reálne pripojiť, aby bolo
  // čo odmietnuť. Na zatvorenom porte by test „prešiel" na ECONNREFUSED a
  // netvrdil by nič o odtlačkoch.
  const wrong = await rejectsWrongFingerprint(port);
  check('nesprávny odtlačok certifikátu spojenie odmietne',
        wrong.includes('does not match the pin'), wrong.trim().split('\n')[0]);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - spojenie sa nekopí a odtlačok sa stále overuje.\n`);
    process.exit(failures ? 1 : 0);
  });
