/**
 * Warehouse map SVG generator for ETILOG warehouse module.
 * Layout based on the real floor plan:
 *  - Zone D: vertical strip (Mini Sklad), 20 locations
 *  - Zone A: top band, 32 locations split 1-22 | 23-32, pillars at 6,18,27
 *  - Zone B: middle band, 32 locations split 1-22 | 23-32, unused (pillar+first aid) between 5-6,17-18,27-28
 *  - Zone C: bottom band, 34 locations continuous, pillars at 6,18,30
 *  - Office area: KONŠTRUKTÉRI + TECHNOLOGIČKY (hatched, right side)
 *
 * Each pallet location gets id="loc-<ZONE>-<NN>" + class="pallet-loc" for app interactivity.
 */
const fs = require('fs');
const path = require('path');

// ---- Geometry ----
const W = 1680, H = 820;
const floorX = 30, floorY = 70, floorW = W - 60, floorH = H - 100;

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

// Color palette per zone
const ZONE_COLORS = {
  A: { fill: 'url(#fill-a)', stroke: '#3b82f6', text: '#1e40af', label: '#2563eb' },
  B: { fill: 'url(#fill-b)', stroke: '#22c55e', text: '#166534', label: '#16a34a' },
  C: { fill: 'url(#fill-c)', stroke: '#f59e0b', text: '#92400e', label: '#d97706' },
  D: { fill: 'url(#fill-d)', stroke: '#ec4899', text: '#9d174d', label: '#db2777' },
};

const out = [];
const p = (s) => out.push(s);

// pad number to 2 digits
const pad = (n) => String(n).padStart(2, '0');

// ---- Cell renderer (tall vertical slot) ----
function cell(zone, num, x, y, w, h, opts = {}) {
  const c = ZONE_COLORS[zone];
  const id = `loc-${zone}-${pad(num)}`;
  p(`    <g class="loc-group">`);
  p(`      <rect id="${id}" class="pallet-loc" data-zone="${zone}" data-num="${num}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`);
  // number label at top of slot
  p(`      <text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="${c.text}" pointer-events="none">${num}</text>`);
  // pillar (small square, partially in cell but usable)
  if (opts.pillar) {
    const px = x + w / 2 - 6, py = y + h / 2 - 6;
    p(`      <rect class="pillar" x="${px}" y="${py}" width="12" height="12" rx="2" fill="#64748b" stroke="#475569" stroke-width="1" pointer-events="none"/>`);
  }
  p(`    </g>`);
}

// ---- Blocked spot (unused: pillar + first aid) ----
function blockedSpot(x, y, w, h, label) {
  p(`    <g class="blocked-spot">`);
  p(`      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="url(#hatch-blocked)" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="4,2"/>`);
  p(`      <rect class="pillar" x="${x + w / 2 - 6}" y="${y + h / 2 - 14}" width="12" height="12" rx="2" fill="#64748b" stroke="#475569" stroke-width="1"/>`);
  // first aid cross
  const cx = x + w / 2, cy = y + h / 2 + 10;
  p(`      <g transform="translate(${cx},${cy})">`);
  p(`        <rect x="-7" y="-7" width="14" height="14" rx="2" fill="#ef4444"/>`);
  p(`        <rect x="-1.5" y="-5" width="3" height="10" fill="#fff"/>`);
  p(`        <rect x="-5" y="-1.5" width="10" height="3" fill="#fff"/>`);
  p(`      </g>`);
  p(`    </g>`);
}

// =========================================================
// SVG HEADER + DEFS
// =========================================================
p(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`);
p(`  <defs>`);
p(`    <linearGradient id="fill-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eff6ff"/><stop offset="1" stop-color="#dbeafe"/></linearGradient>`);
p(`    <linearGradient id="fill-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0fdf4"/><stop offset="1" stop-color="#dcfce7"/></linearGradient>`);
p(`    <linearGradient id="fill-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbeb"/><stop offset="1" stop-color="#fef3c7"/></linearGradient>`);
p(`    <linearGradient id="fill-d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdf2f8"/><stop offset="1" stop-color="#fce7f3"/></linearGradient>`);
p(`    <pattern id="hatch-blocked" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="#f1f5f9"/><path d="M0,6 l6,-6 M-1,1 l2,-2 M5,7 l2,-2" stroke="#cbd5e1" stroke-width="1"/></pattern>`);
p(`    <pattern id="hatch-office" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="#f8fafc"/><path d="M0,8 l8,-8 M-2,2 l4,-4 M6,10 l4,-4" stroke="#cbd5e1" stroke-width="1.2"/></pattern>`);
p(`    <filter id="loc-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1e293b" flood-opacity="0.25"/></filter>`);
p(`  </defs>`);

// Background + floor
p(`  <rect width="${W}" height="${H}" fill="#f8fafc"/>`);
p(`  <rect x="${floorX}" y="${floorY}" width="${floorW}" height="${floorH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" rx="10"/>`);

// Title
p(`  <text x="${W / 2}" y="45" text-anchor="middle" font-size="26" font-weight="800" fill="#0f1729" letter-spacing="0.5">ETILOG&#160;&#160;SKLAD</text>`);
p(`  <text x="${W / 2}" y="62" text-anchor="middle" font-size="12" font-weight="500" fill="#64748b">Interaktívna mapa paletových miest</text>`);

// =========================================================
// LAYOUT REGIONS
// =========================================================
const padIn = 24;
const planX0 = floorX + padIn;     // left edge inside floor
const planY0 = floorY + padIn;
const planY1 = floorY + floorH - padIn;

// Office area (right): KONŠTRUKTÉRI + TECHNOLOGIČKY
const officeW = 70;
const officeX = floorX + floorW - padIn - officeW;

// Zone D strip (left): Mini Sklad
const dW = 78;
const dX = planX0;
const dLabelH = 26; // "Mini Sklad" header height

// Main bands area (between D and office)
const mainX0 = dX + dW + 30;
const mainX1 = officeX - 30;
const mainW = mainX1 - mainX0;

// 3 horizontal bands (A, B, C) with corridors between
const bandGap = 34; // forklift corridor between bands
const bandTop = planY0 + 4;
const bandAvail = (planY1 - bandTop) - bandGap * 2;
const bandH = bandAvail / 3;

const bandAY = bandTop;
const bandBY = bandAY + bandH + bandGap;
const bandCY = bandBY + bandH + bandGap;

// =========================================================
// FORKLIFT PATHS (blue) - draw under cells
// =========================================================
p(`  <g id="forklift-paths">`);
// horizontal corridors between bands
p(`    <rect x="${mainX0 - 6}" y="${bandAY + bandH + 4}" width="${mainW + 12}" height="${bandGap - 8}" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1" stroke-dasharray="9,5" rx="4"/>`);
p(`    <rect x="${mainX0 - 6}" y="${bandBY + bandH + 4}" width="${mainW + 12}" height="${bandGap - 8}" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1" stroke-dasharray="9,5" rx="4"/>`);
p(`    <text x="${mainX0 + mainW / 2}" y="${bandAY + bandH + bandGap / 2 + 4}" text-anchor="middle" font-size="10" font-weight="600" fill="#0284c7" letter-spacing="2">MANIPULAČNÁ CESTA</text>`);
p(`    <text x="${mainX0 + mainW / 2}" y="${bandBY + bandH + bandGap / 2 + 4}" text-anchor="middle" font-size="10" font-weight="600" fill="#0284c7" letter-spacing="2">MANIPULAČNÁ CESTA</text>`);
p(`  </g>`);

// =========================================================
// ZONE D (vertical strip, 20 cells)
// =========================================================
p(`  <g id="zone-D">`);
p(`    <rect x="${dX - 6}" y="${planY0 - 6}" width="${dW + 12}" height="${planY1 - planY0 + 12}" fill="none" stroke="#ec4899" stroke-width="1" stroke-dasharray="2,3" rx="6" opacity="0.5"/>`);
p(`    <text x="${dX + dW / 2}" y="${planY0 + 16}" text-anchor="middle" font-size="12" font-weight="700" fill="#64748b">Mini Sklad</text>`);
const dCellsTop = planY0 + dLabelH;
const dCellH = (planY1 - dCellsTop) / 20;
for (let i = 1; i <= 20; i++) {
  const y = dCellsTop + (i - 1) * dCellH;
  cell('D', i, dX, y + 1, dW, dCellH - 2);
}
// Big zone letter overlay
p(`    <text x="${dX + dW / 2}" y="${(dCellsTop + planY1) / 2 + 10}" text-anchor="middle" font-size="54" font-weight="800" fill="#ec4899" opacity="0.12" pointer-events="none">D</text>`);
p(`  </g>`);

// Helper: render a horizontal band with split sections
// sections: array of {from,to} numbering ranges; corridor drawn between sections
function horizontalBand(zone, y, h, sections, pillars, blocked) {
  const c = ZONE_COLORS[zone];
  p(`  <g id="zone-${zone}">`);
  const total = sections.reduce((acc, s) => acc + (s.to - s.from + 1), 0);
  const corridorW = 30;
  const corridors = sections.length - 1;
  const blockedCount = (blocked || []).length;
  const blockedW = 26;
  // available width for actual cells
  const cellsW = mainW - corridorW * corridors - blockedW * blockedCount;
  const cw = cellsW / total;

  let x = mainX0;
  let firstCellX = x, lastCellX = x;
  sections.forEach((sec, si) => {
    for (let n = sec.from; n <= sec.to; n++) {
      // blocked spot drawn BEFORE this number if configured (between n-1 and n)
      const bk = (blocked || []).find(b => b.before === n);
      if (bk) {
        blockedSpot(x, y + 1, blockedW, h - 2, bk.label);
        x += blockedW;
      }
      const isPillar = pillars && pillars.includes(n);
      cell(zone, n, x, y + 1, cw, h - 2, { pillar: isPillar });
      lastCellX = x + cw;
      x += cw;
    }
    if (si < sections.length - 1) {
      // vertical corridor
      p(`    <rect x="${x + 2}" y="${y + 1}" width="${corridorW - 4}" height="${h - 2}" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1" stroke-dasharray="6,4" rx="3"/>`);
      x += corridorW;
    }
  });
  // big zone letter overlay (centered)
  p(`    <text x="${(firstCellX + lastCellX) / 2}" y="${y + h / 2 + 18}" text-anchor="middle" font-size="58" font-weight="800" fill="${c.label}" opacity="0.12" pointer-events="none">${zone}</text>`);
  p(`  </g>`);
}

// ZONE A: 1-22 | 23-32, pillars 6,18,27
horizontalBand('A', bandAY, bandH, [{ from: 1, to: 22 }, { from: 23, to: 32 }], [6, 18, 27], []);

// ZONE B: 1-22 | 23-32, blocked (unused) between 5-6, 17-18, 27-28
horizontalBand('B', bandBY, bandH, [{ from: 1, to: 22 }, { from: 23, to: 32 }], [], [
  { before: 6, label: 'STĹP + LEKÁRNIČKY' },
  { before: 18, label: 'STĹP + LEKÁRNIČKY' },
  { before: 28, label: 'STĹP + LEKÁRNIČKY' },
]);

// ZONE C: 1-34 continuous, pillars 6,18,30
horizontalBand('C', bandCY, bandH, [{ from: 1, to: 34 }], [6, 18, 30], []);

// =========================================================
// OFFICE AREA (KONŠTRUKTÉRI + TECHNOLOGIČKY)
// =========================================================
p(`  <g id="office-area">`);
p(`    <rect x="${officeX}" y="${planY0}" width="${officeW}" height="${planY1 - planY0}" fill="url(#hatch-office)" stroke="#94a3b8" stroke-width="1.5" rx="6"/>`);
p(`    <text x="${officeX + officeW / 2}" y="${(planY0 + planY1) / 2}" text-anchor="middle" font-size="15" font-weight="700" fill="#475569" transform="rotate(-90 ${officeX + officeW / 2} ${(planY0 + planY1) / 2})" letter-spacing="1">KONŠTRUKTÉRI + TECHNOLOGIČKY</text>`);
p(`  </g>`);

// =========================================================
// LEGEND
// =========================================================
const lgW = 540, lgH = 54, lgX = (W - lgW) / 2, lgY = H - 26;
p(`  <g id="legend" transform="translate(${lgX},${lgY - lgH})">`);
p(`    <rect x="0" y="0" width="${lgW}" height="${lgH}" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" rx="8"/>`);
let lx = 16;
const legendItem = (drawFn, label, w) => {
  drawFn(lx, lgH / 2);
  p(`    <text x="${lx + 24}" y="${lgH / 2 + 4}" font-size="10" fill="#475569">${label}</text>`);
  lx += w;
};
legendItem((x, y) => p(`    <rect x="${x}" y="${y - 8}" width="18" height="16" rx="2" fill="url(#fill-a)" stroke="#3b82f6"/>`), 'Voľné miesto', 110);
legendItem((x, y) => p(`    <rect x="${x}" y="${y - 8}" width="12" height="12" rx="2" fill="#64748b" stroke="#475569"/>`), 'Stĺp (použiteľné)', 130);
legendItem((x, y) => p(`    <rect x="${x}" y="${y - 8}" width="18" height="16" rx="2" fill="url(#hatch-blocked)" stroke="#94a3b8" stroke-dasharray="3,2"/>`), 'Nepoužívané', 110);
legendItem((x, y) => p(`    <rect x="${x}" y="${y - 8}" width="18" height="16" rx="2" fill="#e0f2fe" stroke="#38bdf8" stroke-dasharray="3,2"/>`), 'Cesta', 80);
p(`  </g>`);

// =========================================================
// INTERACTIVE STYLES
// =========================================================
p(`  <style>`);
p(`    .pallet-loc { cursor: pointer; transition: opacity .15s ease, stroke-width .15s ease; }`);
p(`    .loc-group:hover .pallet-loc { stroke-width: 3; filter: url(#loc-shadow); }`);
p(`    .pillar, .blocked-spot { pointer-events: none; }`);
p(`  </style>`);

p(`</svg>`);

const svg = out.join('\n');
const target = path.join(__dirname, '..', 'public', 'portal', 'assets', 'images', 'warehouse-map.svg');
fs.writeFileSync(target, svg, 'utf8');
console.log(`Warehouse SVG written: ${target} (${svg.length} bytes)`);
