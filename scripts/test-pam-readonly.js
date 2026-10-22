#!/usr/bin/env node
/**
 * PAM klient nesmie vedieť zapisovať.
 *
 *   node scripts/test-pam-readonly.js
 *
 * Hlavný zámok je v databáze: účet etilog_portal_ro má db_denydatawriter a
 * SELECT len na štyri tabuľky. Tento test stráži ten druhý, v kóde - aby
 * sme sa o zápis ani nepokúsili, keby niekto raz tomu účtu omylom pridal
 * práva.
 *
 * Beží bez PAM aj bez siete. Každý zamietnutý príkaz musí spadnúť skôr,
 * než sa klient vôbec pokúsi niekam pripojiť; keby to padalo až na
 * pripojení, test by prešiel aj s úplne otvoreným klientom. Preto je
 * konfigurácia zámerne prázdna: nepripojiteľný klient, ktorý musí odmietnuť
 * skôr, a odmietnuť inou chybou než „nie je nastavené".
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

// Žiadne PAM_DB_* - klient sa nemá ako pripojiť. Čokoľvek, čo prejde cez
// kontrolu, padne na konfigurácii, a to vieme rozlíšiť.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('PAM_DB_')) delete process.env[key];
}
process.env.LOG_LEVEL = 'error';

const { PamClient } = require('../src/services/pamClient');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? `${GREEN}OK${OFF}  ` : `${RED}FAIL${OFF}`} ${label}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

const client = new PamClient();

/** Vráti 'odmietnuté' / 'pustené ku spojeniu' / 'prešlo'. */
async function attempt(text) {
  try {
    await client.query(text);
    return 'prešlo';
  } catch (error) {
    // „not configured" znamená, že kontrola príkaz pustila ďalej a zastavilo
    // ho až chýbajúce spojenie. To je pre nás zlyhanie, nie úspech.
    return /not configured|connection failed/i.test(error.message)
      ? 'pustené ku spojeniu'
      : 'odmietnuté';
  }
}

async function main() {
  console.log('\n1. Zápis sa nesmie dostať ani k spojeniu');
  for (const text of [
    "UPDATE dbo.z_dovolenka SET dov_nova = 0 WHERE osu_os_cis = 412",
    "DELETE FROM dbo.z_dovolenka WHERE 1 = 0",
    "INSERT INTO dbo.z_dovolenka (osu_os_cis) VALUES (1)",
    "EXEC sp_who",
    "TRUNCATE TABLE dbo.z_vysl_brutto",
    "DROP TABLE dbo.z_dovolenka",
    "MERGE dbo.z_dovolenka USING dbo.z_identifikacia ON 1 = 0",
    "  \n\t UPDATE dbo.z_dovolenka SET dov_nova = 0"  // biele znaky nepomôžu
  ]) {
    const outcome = await attempt(text);
    check(`${text.trim().split(/\s+/)[0].padEnd(9)} ${outcome === 'odmietnuté' ? 'odmietnuté' : outcome}`,
          outcome === 'odmietnuté', `(${outcome})`);
  }

  console.log('\n2. Druhý príkaz prilepený za prvý');
  // Aj keď sa začína SELECT-om. Bez tohto by sa dal zápis prepašovať za
  // bodkočiarkou a prvá kontrola by ho pustila.
  for (const text of [
    "SELECT 1; DROP TABLE dbo.z_dovolenka",
    "SELECT 1;",
    "WITH x AS (SELECT 1 AS a) SELECT a FROM x; DELETE FROM dbo.z_dovolenka"
  ]) {
    const outcome = await attempt(text);
    check(`bodkočiarka odmietnutá: ${text.slice(0, 34)}…`, outcome === 'odmietnuté', `(${outcome})`);
  }

  console.log('\n3. Čítanie sa zastaví až na spojení, nie na kontrole');
  // Opačný dôkaz: keby kontrola odmietala všetko, body vyššie by prešli samy
  // od seba a nič by nedokazovali.
  for (const text of [
    'SELECT TOP (1) osu_os_cis FROM dbo.z_identifikacia',
    'WITH x AS (SELECT 1 AS a) SELECT a FROM x'
  ]) {
    const outcome = await attempt(text);
    check(`${text.slice(0, 40)}… prejde kontrolou`, outcome === 'pustené ku spojeniu', `(${outcome})`);
  }

  console.log('\n4. Heslo sa nikde neukazuje');
  process.env.PAM_DB_PASSWORD = 'tajne-heslo-ktore-sa-nesmie-objavit';
  const target = JSON.stringify(PamClient.target);
  check('v popise cieľa nie je', !target.includes('tajne-heslo'), target);
  const probe = JSON.stringify(await new PamClient().probe());
  check('ani v odpovedi probe()', !probe.includes('tajne-heslo'), probe);
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - klient do PAM nevie zapísať a heslo nikam nevypisuje.\n`);
    process.exit(failures ? 1 : 0);
  });
