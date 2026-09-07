#!/usr/bin/env node
/**
 * Porovnanie skladu v portáli so skutočným stavom v SAPe.
 *
 * Skladníci zadávali kódy a počty kusov ručne, lebo modul nebol napojený na
 * SAP. Teraz napojený je, takže sa tie dve čísla dajú prvý raz postaviť vedľa
 * seba. Tento skript to spraví a vytvorí PDF, ktoré sa dá vytlačiť a odovzdať.
 *
 * Zo SAPu sa iba ČÍTA - jediné volanie je GET /Items. Nič sa do SAPu nezapisuje
 * a nič sa nemení ani v portáli: skript je celý len na čítanie.
 *
 * Spustenie na VPS (v kontajneri, kde sú prihlasovacie údaje k DB aj k SAPu):
 *
 *   docker exec teams-app node scripts/warehouse-stock-report.js
 *   docker cp teams-app:/tmp/sklad-porovnanie.pdf .
 *
 * Prepínače:
 *   --prefix=FG          len kódy začínajúce na FG (predvolene sa berú všetky)
 *   --warehouse=02-02    porovnať proti jednému skladu v SAPe namiesto súčtu
 *                        cez všetky sklady
 *   --out=/tmp/nazov     kam zapísať (bez prípony; vzniknú .pdf aj .csv)
 *   --csv=false          nevytvárať CSV
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const pool = require('../src/database/config');
const { SapClient } = require('../src/services/sapClient');

const RED = '#D9000C';
const INK = '#1A1513';
const MUTED = '#7B706B';
const LINE = '#E4DCD8';

const FIELDS = 'ItemCode,ItemName,InventoryUOM,QuantityOnStock,ItemWarehouseInfoCollection';

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 1234.5 -> "1 234,5", ako sa čísla píšu po slovensky. */
const qty = (value) => {
  const rounded = Math.round(num(value) * 1000) / 1000;
  return rounded.toLocaleString('sk-SK', { maximumFractionDigits: 3 });
};

/**
 * Sklad v SAPe, proti ktorému sa porovnáva.
 *
 * Nie je to odhad. Prvé porovnanie sa spustilo proti 02-02 a nesedelo nič, tak
 * sa oskórovali všetky sklady, ktoré sa v dátach vôbec vyskytli, proti počtom
 * v portáli - 104 kódov, na ktorých má SAP niekde zásobu:
 *
 *     02-03    39 presných zhôd     priemerná odchýlka   72
 *     súčet    21                                       118
 *     01-18     2                                         4
 *     02-02     0                                       233
 *
 * 02-03 je jediný, ktorý na počty sadá; 02-02 nesedí ani raz. Zo 101 kódov s
 * materiálom ich má 91 zásobu práve v 02-03.
 *
 * `--suggest` to prepočíta na aktuálnych dátach, keby sa sklad presťahoval
 * alebo sa toto číslo raz stalo nepravdou. `--warehouse=all` prepne na súčet.
 */
const DEFAULT_WAREHOUSE = '02-03';

function options(argv) {
  const opts = {
    prefix: null, warehouse: DEFAULT_WAREHOUSE, out: '/tmp/sklad-porovnanie',
    csv: true, suggest: false, markers: true
  };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'prefix') opts.prefix = value || null;
    if (key === 'warehouse') opts.warehouse = (!value || value === 'all') ? null : value;
    if (key === 'out') opts.out = value;
    if (key === 'csv') opts.csv = value !== 'false';
    if (key === 'suggest') opts.suggest = value !== 'false';
    if (key === 'markers') opts.markers = value !== 'false';
  }
  return opts;
}

/**
 * Ktorý zo skladov v SAPe zodpovedá tomu, čo eviduje portál.
 *
 * Otázka, na ktorú sa nedá odpovedať z konfigurácie - dá sa len zmerať. Pre
 * každý sklad, ktorý sa v dátach vyskytne, sa spočíta, koľkokrát jeho počet
 * kusov presne sadne na počet v portáli, a aká je priemerná odchýlka. Sklad,
 * ktorý appka eviduje, vyskočí z toho zoznamu sám.
 *
 * Kódy, na ktorých SAP nemá nikde nič, sa nerátajú: nulou proti nule by sa dal
 * "potvrdiť" ktorýkoľvek sklad.
 */
function suggestWarehouse(matched) {
  const scorable = matched.filter((row) => row.perWarehouse.length > 0);
  const stores = new Set();
  for (const row of scorable) for (const w of row.perWarehouse) stores.add(w.warehouse);

  const score = (pick) => {
    let exact = 0;
    let gap = 0;
    for (const row of scorable) {
      const sap = pick(row);
      if (sap === row.portalQty) exact += 1;
      gap += Math.abs(sap - row.portalQty);
    }
    return { exact, avgGap: scorable.length ? Math.round(gap / scorable.length) : 0 };
  };

  const at = (row, warehouse) => num((row.perWarehouse.find((w) => w.warehouse === warehouse) || {}).inStock);

  const table = [...stores].map((warehouse) => ({
    warehouse, ...score((row) => at(row, warehouse)),
    nonZero: scorable.filter((row) => at(row, warehouse) > 0).length
  }));
  table.push({
    warehouse: 'súčet všetkých',
    ...score((row) => row.perWarehouse.reduce((total, w) => total + w.inStock, 0)),
    nonZero: scorable.length
  });

  table.sort((a, b) => b.exact - a.exact || a.avgGap - b.avgGap);
  return { table, scorable: scorable.length, skipped: matched.length - scorable.length };
}

/**
 * Čo je v sklade podľa portálu - presne to, čo vidno v Evidencii materiálov.
 *
 * `deleted_at IS NULL` je tu to najdôležitejšie. Zmazanie materiálu riadok
 * nezmaže, iba ho označí (migrácia 023), aby sa dal obnoviť aj s paletovými
 * miestami. Bez tejto podmienky sa do porovnania dostanú položky, ktoré v
 * evidencii dávno nie sú, a dokument potom hlási rozdiely na tovare, ktorý
 * nikto neeviduje. Je to tá istá podmienka, akú má `Material.findAll`.
 *
 * Paletové miesta sa berú z `material_placements`, nie z `materials.location_id`:
 * od migrácie 022 môže jeden materiál ležať na viacerých miestach a to staré
 * pole je len pozostatok.
 *
 * Sčítané podľa kódu. Ten je v praxi jedinečný - appka odmietne založiť druhý
 * rovnaký - ale tvrdý UNIQUE na ňom zatiaľ nie je, takže historické duplicity
 * existovať môžu. `rows_count` ich vynesie na povrch.
 */
async function fromPortal(prefix) {
  const { rows } = await pool.query(
    `SELECT m.code,
            min(m.name)              AS name,
            sum(m.quantity)::numeric AS quantity,
            min(m.unit)              AS unit,
            count(*)::int            AS rows_count,
            COALESCE((
              SELECT array_agg(DISTINCT pl.code)
                FROM material_placements mp
                JOIN pallet_locations pl ON pl.id = mp.location_id
               WHERE mp.material_id = ANY(array_agg(m.id))
            ), ARRAY[]::varchar[]) AS locations,
            max(m.updated_at)        AS updated_at
       FROM materials m
      WHERE m.deleted_at IS NULL
        AND ($1::text IS NULL OR m.code ILIKE $1 || '%')
      GROUP BY m.code
      ORDER BY m.code`,
    [prefix]
  );
  return rows;
}

/** Čo o tých istých kódoch hovorí SAP. Iba GET, po dvadsiatich naraz. */
async function fromSap(codes, client) {
  const found = await client.itemsByCode(codes, FIELDS);

  const stock = new Map();
  for (const [code, item] of found) {
    const perWarehouse = (item.ItemWarehouseInfoCollection || [])
      .map((row) => ({ warehouse: row.WarehouseCode, inStock: num(row.InStock) }))
      .filter((row) => row.inStock !== 0)
      .sort((a, b) => b.inStock - a.inStock);

    stock.set(code, {
      name: item.ItemName || null,
      unit: item.InventoryUOM || null,
      total: num(item.QuantityOnStock),
      perWarehouse
    });
  }
  return stock;
}

/**
 * Portál vedľa SAPu, riadok po riadku.
 *
 * Kód, ktorý SAP nepozná, nie je rozdiel v počtoch - je to iná otázka (preklep,
 * vlastné označenie, položka zrušená v SAPe), a preto sa aj v dokumente rieši
 * osobitne. Zmiešať to do jednej tabuľky by znamenalo tváriť sa, že SAP tvrdí
 * nula kusov, čo netvrdí.
 */
function compare(portal, sap, warehouse, markersApart = true) {
  const matched = [];
  const unknown = [];

  for (const row of portal) {
    const item = sap.get(row.code);
    if (!item) {
      unknown.push({ ...row, portalQty: num(row.quantity) });
      continue;
    }

    const sapQty = warehouse
      ? num((item.perWarehouse.find((w) => w.warehouse === warehouse) || {}).inStock)
      : item.total;

    const portalQty = num(row.quantity);
    matched.push({
      ...row,
      portalQty,
      sapQty,
      difference: portalQty - sapQty,
      sapName: item.name,
      sapUnit: item.unit,
      perWarehouse: item.perWarehouse
    });
  }

  // Najväčší rozdiel navrch: to je zoznam, s ktorým sa ide po sklade.
  matched.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.code.localeCompare(b.code));

  /**
   * Riadky, kde portál eviduje presne 1 ks a SAP hovorí niečo iné.
   *
   * V dátach ich je štyridsať a všetky sa volajú Tašky, Police, Bočnice,
   * Dokumentovky alebo Rohy na kryty. To nie je počet kusov - to je značka
   * „tu ležia tašky k tomuto FG". FG100889 má v portáli 1 a v SAPe 78; nikto
   * nestratil 77 tašiek, len sa tá jednotka nikdy nemyslela ako počet.
   *
   * Do rozdielov teda nepatria - zaplavili by zoznam, s ktorým sa ide po
   * sklade, štyridsiatimi riadkami, ktoré nikto prepočítavať nebude. Nič sa
   * nezahadzuje, dostanú vlastnú sekciu. `--markers=false` ich vráti medzi
   * rozdiely, keby sa ukázalo, že ide o skutočné počty.
   */
  const isMarker = (row) => row.portalQty === 1 && row.difference !== 0;

  return {
    matched,
    unknown,
    markers: markersApart ? matched.filter(isMarker) : [],
    differing: matched.filter((row) => row.difference !== 0 && !(markersApart && isMarker(row))),
    agreeing: matched.filter((row) => row.difference === 0)
  };
}

// ------------------------------------------------------------------------ PDF

const COLUMNS = [
  { key: 'code', label: 'Kód', width: 105 },
  { key: 'name', label: 'Názov v portáli', width: 175 },
  { key: 'locations', label: 'Paletové miesto', width: 105 },
  { key: 'portalQty', label: 'Portál', width: 62, align: 'right' },
  { key: 'sapQty', label: 'SAP', width: 62, align: 'right' },
  { key: 'difference', label: 'Rozdiel', width: 62, align: 'right' },
  { key: 'where', label: 'Kde to v SAPe leží', width: 175 }
];

const TABLE_WIDTH = COLUMNS.reduce((total, column) => total + column.width, 0);

function header(doc, opts, counts) {
  doc.fontSize(17).fillColor(RED).text('Porovnanie skladu: portál vs. SAP', 40, 40);
  doc.fontSize(9).fillColor(MUTED).text(
    `ETILOG · vygenerované ${new Date().toLocaleString('sk-SK')}`, 40, doc.y + 2
  );

  const scope = opts.warehouse
    ? `Porovnáva sa proti skladu ${opts.warehouse}`
      + `${opts.warehouse === DEFAULT_WAREHOUSE ? ' (Prešov)' : ''} v SAPe.`
    : 'Porovnáva sa proti súčtu cez všetky sklady v SAPe.';
  const filter = opts.prefix ? ` Len kódy začínajúce na „${opts.prefix}".` : '';

  doc.fontSize(9).fillColor(INK).text(
    `${scope}${filter} Zo strany portálu sú v porovnaní všetky položky, ktoré sú `
    + 'práve teraz v Evidencii materiálov - zmazané položky sa neporovnávajú.',
    40, doc.y + 6, { width: TABLE_WIDTH }
  );

  const tiles = [
    ['Kódov v sklade', counts.total, INK],
    ['Sedí', counts.agreeing, '#1B6E45'],
    ['Nesedí', counts.differing, RED],
    ['Evidované ako 1 ks', counts.markers, '#4A403C'],
    ['SAP kód nepozná', counts.unknown, '#9C5C00']
  ];

  let x = 40;
  const top = doc.y + 10;
  const tileWidth = (TABLE_WIDTH - (tiles.length - 1) * 8) / tiles.length;
  for (const [label, value, colour] of tiles) {
    doc.rect(x, top, tileWidth, 40).fillAndStroke('#FBF9F8', LINE);
    doc.fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x + 10, top + 7, { width: tileWidth - 20 });
    doc.fontSize(16).fillColor(colour).text(String(value), x + 10, top + 18, { width: tileWidth - 20 });
    x += tileWidth + 8;
  }

  doc.y = top + 56;
}

function tableHead(doc) {
  const top = doc.y;
  doc.rect(40, top, TABLE_WIDTH, 18).fill(RED);

  let x = 40;
  doc.fontSize(8).fillColor('#FFFFFF');
  for (const column of COLUMNS) {
    doc.text(column.label, x + 4, top + 5, { width: column.width - 8, align: column.align || 'left' });
    x += column.width;
  }
  doc.y = top + 18;
}

function row(doc, entry) {
  // Nová strana skôr, než riadok pretečie - a hlavička sa zopakuje, lebo
  // tabuľka bez hlavičky na druhej strane sa nedá čítať.
  if (doc.y > 520) {
    doc.addPage();
    doc.y = 40;
    tableHead(doc);
  }

  const top = doc.y;
  const differs = entry.difference !== 0;

  if (differs) doc.rect(40, top, TABLE_WIDTH, 16).fill('#FDECEC');

  const where = (entry.perWarehouse || [])
    .slice(0, 3)
    .map((w) => `${w.warehouse}: ${qty(w.inStock)}`)
    .join(', ');

  const values = {
    code: entry.code,
    // Ten istý kód dvakrát v evidencii je vec, ktorú treba vyriešiť predtým,
    // než sa rieši rozdiel v počtoch - preto to riadok povie.
    name: (entry.name || entry.sapName || '')
      + (entry.rows_count > 1 ? ` (${entry.rows_count}× v evidencii)` : ''),
    locations: entry.locations?.length ? entry.locations.join(', ') : '—',
    portalQty: qty(entry.portalQty),
    sapQty: qty(entry.sapQty),
    difference: `${entry.difference > 0 ? '+' : ''}${qty(entry.difference)}`,
    where: where || '—'
  };

  let x = 40;
  for (const column of COLUMNS) {
    const isDiff = column.key === 'difference';
    doc.fontSize(7.5)
      .fillColor(isDiff && differs ? RED : INK)
      .text(String(values[column.key]), x + 4, top + 4, {
        width: column.width - 8,
        align: column.align || 'left',
        lineBreak: false,
        ellipsis: true,
        // Bez tejto výšky presiakne do riadku pod sebou spodok druhého riadku
        // dlhého názvu - orezaný pás, ktorý sa nedá prečítať a vyzerá ako chyba
        // tlače. `lineBreak: false` sám o sebe to nezastaví.
        height: 10
      });
    x += column.width;
  }

  doc.moveTo(40, top + 16).lineTo(40 + TABLE_WIDTH, top + 16).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.y = top + 16;
}

function section(doc, title, note) {
  if (doc.y > 480) { doc.addPage(); doc.y = 40; }
  doc.moveDown(1);
  doc.fontSize(12).fillColor(INK).text(title, 40, doc.y);
  if (note) doc.fontSize(8.5).fillColor(MUTED).text(note, 40, doc.y + 2, { width: TABLE_WIDTH });
  doc.y += 8;
}

function signatures(doc) {
  if (doc.y > 460) { doc.addPage(); doc.y = 40; }
  doc.moveDown(2);
  const top = doc.y;
  for (const [i, label] of ['Vypracoval', 'Prevzal (sklad)', 'Dátum'].entries()) {
    const x = 40 + i * 250;
    doc.moveTo(x, top + 22).lineTo(x + 200, top + 22).strokeColor('#B9AFA9').lineWidth(0.8).stroke();
    doc.fontSize(8).fillColor(MUTED).text(label, x, top + 26);
  }
}

function buildPdf(result, opts, target) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape', bufferPages: true });
  doc.registerFont('DejaVu', path.join(__dirname, '../public/fonts/dejavu-sans.ttf'));
  doc.font('DejaVu');

  const stream = fs.createWriteStream(target);
  doc.pipe(stream);

  header(doc, opts, {
    total: result.matched.length + result.unknown.length,
    agreeing: result.agreeing.length,
    differing: result.differing.length,
    markers: result.markers?.length || 0,
    unknown: result.unknown.length
  });

  if (result.differing.length) {
    section(doc, `Rozdiely (${result.differing.length})`,
      'Zoradené podľa veľkosti rozdielu. Kladný rozdiel znamená, že portál hlási viac než SAP.');
    tableHead(doc);
    for (const entry of result.differing) row(doc, entry);
  }

  if (result.agreeing.length) {
    section(doc, `Sedí (${result.agreeing.length})`, 'Počet v portáli sa zhoduje so SAPom.');
    tableHead(doc);
    for (const entry of result.agreeing) row(doc, entry);
  }

  if (result.markers?.length) {
    section(doc, `Evidované ako 1 ks (${result.markers.length})`,
      'Portál pri nich eviduje presne jeden kus a volajú sa Tašky, Police, Bočnice a podobne. '
      + 'Vyzerá to na značku „tu to leží" a nie na počet kusov, preto nie sú medzi rozdielmi. '
      + 'Ak niektorý z nich počet naozaj je, treba ho prepočítať.');
    tableHead(doc);
    for (const entry of result.markers) row(doc, entry);
  }

  if (result.unknown.length) {
    section(doc, `Kódy, ktoré SAP nepozná (${result.unknown.length})`,
      'Nie je to rozdiel v počtoch. SAP o takom kóde nevie vôbec - býva to preklep, '
      + 'vlastné označenie skladu alebo položka, ktorá už v SAPe neexistuje. '
      + 'Treba ich prejsť ručne.');

    const top = doc.y;
    doc.rect(40, top, TABLE_WIDTH, 18).fill('#9C5C00');
    doc.fontSize(8).fillColor('#FFFFFF');
    doc.text('Kód', 44, top + 5, { width: 160 });
    doc.text('Názov v portáli', 210, top + 5, { width: 300 });
    doc.text('Paletové miesto', 515, top + 5, { width: 140 });
    doc.text('Portál', 660, top + 5, { width: 80, align: 'right' });
    doc.y = top + 18;

    for (const entry of result.unknown) {
      if (doc.y > 520) { doc.addPage(); doc.y = 40; }
      const y = doc.y;
      doc.fontSize(7.5).fillColor(INK);
      doc.text(entry.code, 44, y + 4, { width: 160, lineBreak: false, ellipsis: true });
      doc.text(entry.name || '', 210, y + 4, { width: 300, lineBreak: false, ellipsis: true });
      doc.text(entry.locations?.length ? entry.locations.join(', ') : '—', 515, y + 4,
        { width: 140, lineBreak: false, ellipsis: true });
      doc.text(qty(entry.portalQty), 660, y + 4, { width: 80, align: 'right' });
      doc.moveTo(40, y + 16).lineTo(40 + TABLE_WIDTH, y + 16).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.y = y + 16;
    }
  }

  signatures(doc);

  // Čísla strán až na konci, keď je známe, koľko ich je.
  //
  // Spodný okraj sa najprv vypne. Text zapísaný pod hranicou okraja si v
  // PDFKite vypýta novú stranu - pätička si tak sama vyrobila prázdnu stranu
  // navyše a číslovanie potom sedelo len na tej prázdnej.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc.fontSize(7.5).fillColor(MUTED).text(
      `ETILOG · Porovnanie skladu so SAPom · strana ${i + 1} z ${range.count}`,
      40, doc.page.height - 28, { width: TABLE_WIDTH, align: 'center' }
    );
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/** To isté v CSV, aby sa s tým dalo ďalej robiť v Exceli. */
function buildCsv(result, target) {
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['kod', 'nazov', 'paletove_miesta', 'portal_ks', 'sap_ks', 'rozdiel', 'sap_sklady', 'stav']
      .map(cell).join(';')
  ];

  const markerIds = new Set((result.markers || []).map((row) => row.code));
  for (const entry of result.matched) {
    lines.push([
      entry.code, entry.name || '', (entry.locations || []).join(' '),
      num(entry.portalQty), num(entry.sapQty), num(entry.difference),
      (entry.perWarehouse || []).map((w) => `${w.warehouse}:${w.inStock}`).join(' '),
      entry.difference === 0 ? 'sedi' : markerIds.has(entry.code) ? 'evidovane_ako_1ks' : 'nesedi'
    ].map(cell).join(';'));
  }
  for (const entry of result.unknown) {
    lines.push([
      entry.code, entry.name || '', (entry.locations || []).join(' '),
      num(entry.portalQty), '', '', '', 'sap_nepozna'
    ].map(cell).join(';'));
  }

  // BOM, inak Excel zobrazí diakritiku ako neporiadok.
  fs.writeFileSync(target, `﻿${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const opts = options(process.argv.slice(2));

  const portal = await fromPortal(opts.prefix);
  if (!portal.length) {
    console.log('V sklade nie sú žiadne položky' + (opts.prefix ? ` s predponou ${opts.prefix}.` : '.'));
    return;
  }
  console.log(`Sklad: ${portal.length} rôznych kódov. Pýtam sa SAPu…`);

  const client = new SapClient();
  const sap = await fromSap(portal.map((row) => row.code), client);
  await client.logout().catch(() => {});

  console.log(`SAP pozná ${sap.size} z nich.`);

  if (opts.suggest) {
    // Porovnávacie číslo tu musí byť súčet cez sklady, nie jeden z nich, inak
    // by sa skóre počítalo proti odpovedi, ktorú práve hľadáme.
    const { table, scorable, skipped } = suggestWarehouse(compare(portal, sap, null).matched);
    console.log(`\nKódov, na ktorých má SAP niekde zásobu: ${scorable}`
      + ` (${skipped} bez zásoby kdekoľvek sa neráta)\n`);
    console.log('sklad             presné zhody   nenulových   priemerná odchýlka');
    for (const row of table) {
      console.log(
        `${row.warehouse.padEnd(18)}${String(row.exact).padStart(12)}`
        + `${String(row.nonZero).padStart(13)}${String(row.avgGap).padStart(21)}`
      );
    }
    console.log(`\nPredvolený je ${DEFAULT_WAREHOUSE}. Ak je navrchu iný, spusti to s --warehouse=<kód>.`);
    return;
  }

  const result = compare(portal, sap, opts.warehouse, opts.markers);
  await buildPdf(result, opts, `${opts.out}.pdf`);
  if (opts.csv) buildCsv(result, `${opts.out}.csv`);

  console.log(
    `\nSedí: ${result.agreeing.length} · Nesedí: ${result.differing.length} · `
    + `Evidované ako 1 ks: ${result.markers.length} · SAP nepozná: ${result.unknown.length}`
  );
  console.log(`\nPDF: ${opts.out}.pdf`);
  if (opts.csv) console.log(`CSV: ${opts.out}.csv`);
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Nepodarilo sa:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { compare, fromPortal, fromSap, buildPdf, buildCsv, options, DEFAULT_WAREHOUSE };
