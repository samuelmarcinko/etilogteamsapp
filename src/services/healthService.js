const crypto = require('crypto');
const fs = require('fs/promises');

const pool = require('../database/config');
const WarehouseSyncService = require('./warehouseSyncService');
const { PamClient } = require('./pamClient');
const logger = require('../utils/logger');

/**
 * Čo musí byť v poriadku, aby portál skutočne fungoval.
 *
 * Toto nie je to isté, čo `/health`. Tá adresa odpovedá na otázku „beží
 * proces?" a sleduje ju Traefik s Dockerom - keby začala padať kvôli
 * nedostupnému SAPu, zhodili by celý portál kvôli problému so skladovými
 * číslami. Tieto dve otázky musia zostať oddelené.
 *
 * Toto je druhá otázka: „je systém zdravý?" Sleduje ju externý dohľad mimo
 * servera - lebo nič, čo beží na tomto stroji, nedokáže povedať, že tento
 * stroj je mŕtvy.
 */

// Synchronizácia beží o 05:30 a 13:30, teda medzery 8 a 16 hodín. Prah musí
// byť nad tou dlhšou, inak by poplach zvonil každé ráno pred pol šiestou.
const SYNC_STALE_HOURS = Number(process.env.HEALTH_SYNC_STALE_HOURS || 20);

// Kvóty z PAM sa ťahajú raz denne o 05:45, teda medzera 24 hodín. Prah musí
// byť nad ňou, inak by poplach zvonil každé ráno pred šiestou.
const PAM_STALE_HOURS = Number(process.env.HEALTH_PAM_STALE_HOURS || 30);
const DISK_MAX_PERCENT = Number(process.env.HEALTH_DISK_MAX_PERCENT || 85);
const DB_TIMEOUT_MS = 5000;

/**
 * Disky, na ktoré appka z kontajnera dovidí.
 *
 *   /app/backups  je prípojka z hostiteľského koreňového disku
 *   /host-data    je prázdny priečinok z dátového disku, pripojený len na
 *                 meranie - `statfs` vráti údaje o celom zväzku, takže sa
 *                 voľné miesto dá zmerať bez toho, aby appka videla čokoľvek
 *                 z jeho obsahu
 *
 * Čo nie je pripojené, to sa ticho preskočí: merať sa dá len to, na čo je
 * vidieť, a predstierať opak by bolo horšie než nemerať.
 */
const DISK_PATHS = (process.env.HEALTH_DISK_PATHS || '/app/backups,/host-data')
  .split(',').map((path) => path.trim()).filter(Boolean);

/** Zhoda kľúča bez toho, aby čas odpovede prezradil, koľko znakov sedelo. */
function keyMatches(given) {
  const expected = process.env.HEALTH_CHECK_KEY || '';
  if (!expected || !given) return false;

  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function enabled() {
  return Boolean(process.env.HEALTH_CHECK_KEY);
}

async function checkDatabase() {
  const started = Date.now();
  try {
    // Časový strop je tu podstatný: zaseknutá databáza by inak držala odpoveď
    // otvorenú, dohľad by čakal a poplach by prišiel neskoro alebo vôbec.
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`neodpovedala do ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS))
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, detail: `Databáza neodpovedá: ${error.message}` };
  }
}

async function checkDisks() {
  const disks = [];

  for (const path of DISK_PATHS) {
    let stats;
    try {
      stats = await fs.statfs(path);
    } catch (error) {
      continue;   // nepripojené - nemeriame, netvárime sa, že vieme
    }

    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (!total) continue;

    const usedPercent = Math.round(((total - free) / total) * 100);
    disks.push({
      path,
      usedPercent,
      freeGb: Math.round((free / 1024 / 1024 / 1024) * 10) / 10,
      ok: usedPercent < DISK_MAX_PERCENT
    });
  }

  if (!disks.length) {
    return { ok: false, detail: 'Nedá sa zmerať voľné miesto na žiadnom disku' };
  }

  const full = disks.filter((disk) => !disk.ok);
  return {
    ok: full.length === 0,
    disks,
    detail: full.length
      ? full.map((d) => `Disk ${d.path} je na ${d.usedPercent} % (limit ${DISK_MAX_PERCENT} %), voľné ${d.freeGb} GB`).join('; ')
      : undefined
  };
}

/**
 * Synchronizácia so SAPom.
 *
 * Poplach má dva dôvody a je medzi nimi rozdiel, ktorý sa oplatí povedať:
 * beh, ktorý zlyhal, znamená, že SAP alebo tunel neodpovedal práve teraz;
 * starý beh znamená, že sa už dlho ani nespustil. Prvé býva výpadok linky,
 * druhé zaseknutý plánovač.
 */
async function checkSapSync() {
  let last;
  try {
    last = await WarehouseSyncService.lastRun();
  } catch (error) {
    return { ok: false, detail: `Stav synchronizácie sa nedá prečítať: ${error.message}` };
  }

  if (!last) {
    return { ok: false, detail: 'Synchronizácia so SAPom ešte nikdy nebežala' };
  }

  const when = new Date(last.finished_at || last.started_at);
  const ageHours = Math.round(((Date.now() - when.getTime()) / 3600000) * 10) / 10;
  const stale = ageHours > SYNC_STALE_HOURS;

  return {
    ok: Boolean(last.ok) && !stale,
    lastRunAt: when.toISOString(),
    ageHours,
    detail: !last.ok
      ? `Posledná synchronizácia so SAPom zlyhala (${when.toISOString()}): ${last.error || 'bez bližšieho dôvodu'}`
      : stale
        ? `Synchronizácia so SAPom nebežala ${ageHours} hodín (limit ${SYNC_STALE_HOURS})`
        : undefined
  };
}

/**
 * Kvóty z PAM.
 *
 * Toto zlyháva ticho a práve preto sa to musí strážiť. Keď sa ranný beh
 * nespustí alebo PAM neodpovie, kvóty sa nevynulujú ani nezmiznú - zostanú
 * ležať tie včerajšie. Na obrazovke to vyzerá úplne v poriadku a prísť na
 * to by sa dalo až vtedy, keď niekomu nesedí zostatok.
 *
 * Rozlišujú sa dva rôzne problémy:
 *
 *   nikto sa dlho nesynchronizoval  -> neozval sa PAM alebo stojí plánovač
 *   niekto konkrétny zaostáva       -> jeho osobné číslo PAM nepozná, alebo
 *                                      za tento rok nemá nárok na dovolenku
 *
 * To druhé je typicky preklep v osobnom čísle. Bez tejto kontroly by taký
 * človek ostal navždy na starých hodnotách a nikto by o tom nevedel.
 */
async function checkPamSync() {
  // Nasadenie, ktoré PAM nepoužíva, nemá kvôli nemu hlásiť poruchu.
  if (!PamClient.configured) {
    return { ok: true, configured: false };
  }

  const year = new Date().getFullYear();
  let row;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS mapped,
              COUNT(eq.pam_synced_at)::int AS synced,
              MAX(eq.pam_synced_at) AS newest,
              COUNT(*) FILTER (
                WHERE eq.pam_synced_at IS NULL
                   OR eq.pam_synced_at < NOW() - ($2 || ' hours')::interval
              )::int AS stale
         FROM users u
         LEFT JOIN employee_quotas eq ON eq.user_id = u.user_id AND eq.year = $1
        WHERE COALESCE(u.is_external, FALSE) = FALSE
          AND u.personal_number IS NOT NULL
          AND COALESCE(u.hidden, FALSE) = FALSE`,
      [year, PAM_STALE_HOURS]
    );
    row = result.rows[0];
  } catch (error) {
    return { ok: false, detail: `Stav kvót z PAM sa nedá prečítať: ${error.message}` };
  }

  // Nikoho ešte nespárovali. Nie je to porucha - kolegyňa osobné čísla
  // dopĺňa postupne a kým ich nezadá, kvóty fungujú po starom.
  if (!row.mapped) {
    return { ok: true, configured: true, mapped: 0 };
  }

  // Hneď po Novom roku ešte riadky za nový rok neexistujú a prvý beh príde
  // až o 05:45. Bez tejto výnimky by 1. januára nadránom zvonil poplach,
  // ktorý by sa sám od seba stratil.
  const sinceYearStart = Date.now() - new Date(year, 0, 1).getTime();
  const tooEarly = sinceYearStart < PAM_STALE_HOURS * 3600000;

  const newest = row.newest ? new Date(row.newest) : null;
  const ageHours = newest
    ? Math.round(((Date.now() - newest.getTime()) / 3600000) * 10) / 10
    : null;

  if (!newest) {
    return {
      ok: tooEarly, configured: true, mapped: row.mapped, synced: 0,
      detail: tooEarly ? undefined
        : `Kvóty z PAM sa za rok ${year} ešte ani raz nenačítali (${row.mapped} spárovaných ľudí)`
    };
  }

  if (ageHours > PAM_STALE_HOURS) {
    return {
      ok: false, configured: true, mapped: row.mapped, synced: row.synced,
      lastSyncAt: newest.toISOString(), ageHours,
      detail: `Kvóty z PAM sa nenačítali ${ageHours} hodín (limit ${PAM_STALE_HOURS})`
    };
  }

  // Beh prešiel, ale niekto v ňom neprešiel. Takmer vždy preklep v osobnom
  // čísle alebo chýbajúci nárok - a práve tento človek vidí staré kvóty.
  //
  // Upozornenie, nie porucha. Opraviť sa to dá len v HR module alebo v
  // samotnom PAM, teda to patrí kolegyni cez deň - nie dohľadu, ktorý budí
  // o pol jedenástej v noci. Keby to zhadzovalo celú adresu, zmizol by
  // rozdiel medzi "portál nefunguje" a "jednej osemnástine ľudí treba
  // opraviť osobné číslo".
  if (row.stale > 0) {
    return {
      ok: true, warn: true, configured: true, mapped: row.mapped, synced: row.synced,
      lastSyncAt: newest.toISOString(), ageHours, stale: row.stale,
      detail: `${row.stale} z ${row.mapped} spárovaných ľudí nemá čerstvé kvóty z PAM `
            + '- pravdepodobne nesedí osobné číslo alebo im v PAM chýba nárok'
    };
  }

  return {
    ok: true, configured: true, mapped: row.mapped, synced: row.synced,
    lastSyncAt: newest.toISOString(), ageHours
  };
}

/**
 * Celý stav naraz.
 *
 * Kontroly bežia súbežne a žiadna z nich nesmie zhodiť odpoveď - keby sa
 * výnimka v jednej prepísala na chybu 500, dohľad by hlásil „server
 * nedostupný" namiesto toho, čo je naozaj zle.
 *
 * Stavy sú tri, nie dva, a ten rozdiel je tu podstatný:
 *
 *   ok     všetko sedí
 *   warn   systém funguje, ale niečo si vyžaduje človeka - typicky zle
 *          zadané osobné číslo. Vracia sa 200, takže dohľad nezvoní.
 *   fail   systém je pokazený: databáza, disk, synchronizácia ako celok.
 *          Vracia sa 503 a dohľad budí.
 *
 * Dohľad sa pozerá len na návratový kód. Keby upozornenie vracalo 503,
 * hlásil by „portál nefunguje" v okamihu, keď jednému človeku z osemnástich
 * treba opraviť číslo - a po treťom takom hlásení by si ich už nikto
 * nevšímal ani vtedy, keď by portál naozaj ležal.
 */
async function check() {
  const [database, disk, sapSync, pamSync] = await Promise.all([
    checkDatabase().catch((error) => ({ ok: false, detail: `Kontrola databázy padla: ${error.message}` })),
    checkDisks().catch((error) => ({ ok: false, detail: `Kontrola diskov padla: ${error.message}` })),
    checkSapSync().catch((error) => ({ ok: false, detail: `Kontrola synchronizácie padla: ${error.message}` })),
    checkPamSync().catch((error) => ({ ok: false, detail: `Kontrola kvót z PAM padla: ${error.message}` }))
  ]);

  const checks = { database, disk, sapSync, pamSync };
  const failing = Object.entries(checks).filter(([, value]) => !value.ok).map(([name]) => name);
  const warnings = Object.entries(checks).filter(([, value]) => value.ok && value.warn).map(([name]) => name);

  // Poruchy prvé: v upozornení z dohľadu býva vidieť len začiatok odpovede.
  const detailsOf = (names) => names.map((name) => checks[name].detail).filter(Boolean);
  const details = [...detailsOf(failing), ...detailsOf(warnings)];

  const report = {
    // `summary` je prvé a je celou vetou naschvál: práve tam má stáť, čo sa
    // deje, aj keď sa z odpovede nič iné neprečíta.
    summary: details.length ? details.join(' | ') : 'Všetko v poriadku',
    status: failing.length ? 'fail' : warnings.length ? 'warn' : 'ok',
    failing,
    warnings,
    checkedAt: new Date().toISOString(),
    checks
  };

  if (failing.length) {
    logger.warn('Health check failed', { failing, summary: report.summary });
  } else if (warnings.length) {
    logger.info('Health check warning', { warnings, summary: report.summary });
  }
  return report;
}

module.exports = { check, keyMatches, enabled, SYNC_STALE_HOURS, DISK_MAX_PERCENT, PAM_STALE_HOURS };
