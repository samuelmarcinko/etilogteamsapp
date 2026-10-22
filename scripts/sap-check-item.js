#!/usr/bin/env node
/**
 * Čo o jednom FG vie SAP a čo o ňom vie naša zrkadlová kópia.
 *
 *   node scripts/sap-check-item.js FG100934
 *
 * Nástroj na pozretie, nie test. Vznikol pri otázke „prečo mi projekt
 * nevyskočil v Open Orders a prečo sa nenačítal jeho názov" - a odpoveď na ňu
 * je zakaždým na jednom z troch miest, ktoré sa dovtedy dali porovnať len
 * ručne:
 *
 *   `sap_items`              číselník, z ktorého berieme názov projektu
 *   `sap_production_orders`  z toho sa skladá zoznam „Open projects in SAP"
 *   samotný SAP              kde je pravda
 *
 * Do SAPu sa výhradne číta. Klient to má zabezpečené na svojej úrovni -
 * odmietne čokoľvek okrem GET (a prihlásenia) - takže tento skript nemá ako
 * do SAPu zapísať, ani keby chcel.
 *
 * Spúšťa sa vnútri kontajnera, kde je nastavenie SAPu a tunel:
 *
 *   sudo docker exec teams-app node scripts/sap-check-item.js FG100934
 */

require('dotenv').config();

const code = String(process.argv[2] || '').trim().toUpperCase();
if (!code) {
  console.error('\nPoužitie: node scripts/sap-check-item.js FG100934\n');
  process.exit(2);
}

process.env.LOG_LEVEL ||= 'error';

const pool = require('../src/database/config');
const { SapClient } = require('../src/services/sapClient');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

const h = (text) => console.log(`\n${BOLD}${text}${OFF}`);
const yes = (text) => console.log(`  ${GREEN}✓${OFF} ${text}`);
const no = (text) => console.log(`  ${RED}✗${OFF} ${text}`);
const dim = (text) => console.log(`  ${DIM}${text}${OFF}`);

async function mirror() {
  h(`1. Zrkadlo — číselník (sap_items)`);
  const { rows: items } = await pool.query(
    'SELECT item_code, item_name, project_type, synced_at FROM sap_items WHERE item_code = $1',
    [code]
  );
  if (!items.length) {
    no(`${code} v zrkadle číselníka nie je — preto sa nemá odkiaľ vziať názov.`);
  } else {
    yes(`názov: ${items[0].item_name || '(prázdny aj v zrkadle)'}`);
    dim(`typ projektu: ${items[0].project_type || '—'} · načítané ${items[0].synced_at?.toISOString?.() || items[0].synced_at}`);
  }

  h('2. Zrkadlo — výrobné objednávky (sap_production_orders)');
  const { rows: orders } = await pool.query(
    `SELECT absolute_entry, status, planned_qty, completed_qty, is_finished_good, due_date
       FROM sap_production_orders WHERE item_code = $1 ORDER BY absolute_entry DESC`,
    [code]
  );
  if (!orders.length) {
    no('žiadna objednávka — preto projekt nie je v zozname „Open projects in SAP".');
  } else {
    for (const o of orders) {
      const line = `#${o.absolute_entry} · ${o.status} · ${o.planned_qty} plán / ${o.completed_qty} hotové`;
      // Do zoznamu projektov sa dostanú len objednávky označené ako hotový
      // výrobok - ostatné sú polotovary a tie sa neplánujú ako projekt.
      if (o.is_finished_good) yes(`${line}  → v zozname projektov JE`);
      else no(`${line}  → nie je označená ako hotový výrobok, do zoznamu sa nedostane`);
    }
  }

  h('3. Zrkadlo — kusovník (sap_boms)');
  const { rows: [bom] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM sap_boms WHERE parent_code = $1', [code]);
  if (bom.n) yes(`${bom.n} položiek na prvej úrovni`);
  else no('kusovník nie je načítaný');

  const { rows: [sync] } = await pool.query(
    'SELECT MAX(finished_at) AS at FROM sap_sync_log WHERE ok').catch(() => ({ rows: [{}] }));
  if (sync?.at) dim(`\n  posledná úspešná synchronizácia: ${sync.at.toISOString?.() || sync.at}`);
}

async function live() {
  h('4. Živý SAP — len čítanie');

  const blocked = SapClient.misconfigured;
  if (blocked) {
    no(`do SAPu sa teraz ísť nedá: ${blocked}`);
    return;
  }

  const sap = new SapClient();
  try {
    const item = await sap.getOrNull(
      `/Items('${code.replace(/'/g, "''")}')?$select=ItemCode,ItemName,ProcurementMethod,QuantityOnStock`
    );
    if (!item) no(`SAP taký kód nepozná.`);
    else {
      yes(`názov v SAPe: ${item.ItemName || '(v SAPe je prázdny)'}`);
      dim(`spôsob obstarania: ${item.ProcurementMethod || '—'} · na sklade: ${item.QuantityOnStock ?? '—'}`);
    }

    const orders = await sap.list(
      `ProductionOrders?$select=AbsoluteEntry,ItemNo,ProductDescription,PlannedQuantity,CompletedQuantity,ProductionOrderStatus,DueDate` +
      `&$filter=ItemNo eq '${code.replace(/'/g, "''")}'`,
      { max: 50 }
    );

    console.log('');
    if (!orders.length) {
      no('v SAPe nie je na tento kód žiadna výrobná objednávka.');
      dim('To je legitímne: projekt sa dá plánovať aj skôr, než preň objednávka vznikne.');
    } else {
      for (const o of orders) {
        const left = Number(o.PlannedQuantity || 0) - Number(o.CompletedQuantity || 0);
        const open = o.ProductionOrderStatus === 'boposReleased' || o.ProductionOrderStatus === 'boposPlanned';
        const line = `#${o.AbsoluteEntry} · ${o.ProductionOrderStatus} · ${o.PlannedQuantity} plán / ${o.CompletedQuantity} hotové (zostáva ${left})`;
        if (open && left > 0) yes(`${line}  → otvorená`);
        else dim(`  ${line}  → zatvorená alebo dorobená`);
        if (o.ProductDescription) dim(`      popis na objednávke: ${o.ProductDescription}`);
      }
    }
  } catch (error) {
    no(`SAP neodpovedal: ${error.message}`);
  } finally {
    await sap.logout().catch(() => {});
  }
}

(async () => {
  console.log(`\n${BOLD}${code}${OFF}${DIM} — čo o ňom vieme${OFF}`);
  try {
    await mirror();
    await live();
  } catch (error) {
    console.error(`\n${RED}${error.message}${OFF}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    console.log('');
  }
})();
