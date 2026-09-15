const crypto = require('crypto');
const fs = require('fs/promises');

const pool = require('../database/config');
const WarehouseSyncService = require('./warehouseSyncService');
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
 * Celý stav naraz.
 *
 * Kontroly bežia súbežne a žiadna z nich nesmie zhodiť odpoveď - keby sa
 * výnimka v jednej prepísala na chybu 500, dohľad by hlásil „server
 * nedostupný" namiesto toho, čo je naozaj zle.
 */
async function check() {
  const [database, disk, sapSync] = await Promise.all([
    checkDatabase().catch((error) => ({ ok: false, detail: `Kontrola databázy padla: ${error.message}` })),
    checkDisks().catch((error) => ({ ok: false, detail: `Kontrola diskov padla: ${error.message}` })),
    checkSapSync().catch((error) => ({ ok: false, detail: `Kontrola synchronizácie padla: ${error.message}` }))
  ]);

  const checks = { database, disk, sapSync };
  const failing = Object.entries(checks).filter(([, value]) => !value.ok).map(([name]) => name);

  const report = {
    // `summary` je prvé a je celou vetou naschvál: v upozornení z dohľadu je
    // často vidieť len začiatok odpovede, a práve tam má stáť, čo sa deje.
    summary: failing.length
      ? Object.values(checks).filter((c) => !c.ok).map((c) => c.detail).filter(Boolean).join(' | ')
      : 'Všetko v poriadku',
    status: failing.length ? 'fail' : 'ok',
    failing,
    checkedAt: new Date().toISOString(),
    checks
  };

  if (failing.length) {
    logger.warn('Health check failed', { failing, summary: report.summary });
  }
  return report;
}

module.exports = { check, keyMatches, enabled, SYNC_STALE_HOURS, DISK_MAX_PERCENT };
