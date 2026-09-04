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

function options(argv) {
  const opts = { prefix: null, warehouse: null, out: '/tmp/sklad-porovnanie', csv: true };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'prefix') opts.prefix = value || null;
    if (key === 'warehouse') opts.warehouse = value || null;
    if (key === 'out') opts.out = value;
    if (key === 'csv') opts.csv = value !== 'false';
  }
  return opts;
}

/**
 * Čo je v sklade podľa portálu.
 *
 * Sčítané podľa kódu, nie podľa riadku: ten istý kód môže ležať na viacerých
 * paletových miestach a skladník ho tam zadal viackrát. Porovnávať sa dá len
 * súčet - SAP o paletách nevie.
 */
async function fromPortal(prefix) {
  const { rows } = await pool.query(
    `SELECT m.code,
            min(m.name)                         AS name,
            sum(m.quantity)::numeric            AS quantity,
            min(m.unit)                         AS unit,
            count(*)::int                       AS rows_count,
            array_remove(array_agg(DISTINCT l.code), NULL) AS locations,
            max(m.updated_at)                   AS updated_at
       FROM materials m
       LEFT JOIN pallet_locations l ON l.id = m.location_id
      WHERE ($1::text IS NULL OR m.code ILIKE $1 || '%')
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
function compare(portal, sap, warehouse) {
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

  return {
    matched,
    unknown,
    differing: matched.filter((row) => row.difference !== 0),
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
    ? `Porovnáva sa proti skladu ${opts.warehouse} v SAPe.`
    : 'Porovnáva sa proti súčtu cez všetky sklady v SAPe.';
  const filter = opts.prefix ? ` Len kódy začínajúce na „${opts.prefix}".` : '';

  doc.fontSize(9).fillColor(INK).text(
    `${scope}${filter} Počty v portáli sú sčítané cez všetky paletové miesta, `
    + 'na ktorých ten istý kód leží.',
    40, doc.y + 6, { width: TABLE_WIDTH }
  );

  const tiles = [
    ['Kódov v sklade', counts.total, INK],
    ['Sedí', counts.agreeing, '#1B6E45'],
    ['Nesedí', counts.differing, RED],
    ['SAP kód nepozná', counts.unknown, '#9C5C00']
  ];

  let x = 40;
  const top = doc.y + 10;
  for (const [label, value, colour] of tiles) {
    doc.rect(x, top, 150, 40).fillAndStroke('#FBF9F8', LINE);
    doc.fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x + 10, top + 7, { width: 130 });
    doc.fontSize(16).fillColor(colour).text(String(value), x + 10, top + 18, { width: 130 });
    x += 158;
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
    name: entry.name || entry.sapName || '',
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
        ellipsis: true
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

  for (const entry of result.matched) {
    lines.push([
      entry.code, entry.name || '', (entry.locations || []).join(' '),
      num(entry.portalQty), num(entry.sapQty), num(entry.difference),
      (entry.perWarehouse || []).map((w) => `${w.warehouse}:${w.inStock}`).join(' '),
      entry.difference === 0 ? 'sedi' : 'nesedi'
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

  const result = compare(portal, sap, opts.warehouse);
  await buildPdf(result, opts, `${opts.out}.pdf`);
  if (opts.csv) buildCsv(result, `${opts.out}.csv`);

  console.log(
    `\nSedí: ${result.agreeing.length} · Nesedí: ${result.differing.length} · `
    + `SAP nepozná: ${result.unknown.length}`
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

module.exports = { compare, fromPortal, fromSap, buildPdf, buildCsv };
