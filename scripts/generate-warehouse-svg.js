/**
 * ETILOG Warehouse Map SVG Generator v2
 *
 * Layout:
 *  - Mini Sklad: separate zone (left edge), own interactive area
 *  - Zone D: vertical strip, 20 locations (next to Mini Sklad)
 *  - Zone A: top band, 32 locations split 1-22 | 23-32, pillars at 6,18,27
 *  - Zone B: middle band, 32 locations split, unused between 5-6,17-18,27-28
 *  - Zone C: bottom band, 34 locations, pillars at 6,18,30
 *  - Office: KONŠTRUKTÉRI + TECHNOLOGIČKY (right)
 *  - Vertical corridors: left side (by D) and right side (by office)
 */
const fs = require('fs');
const path = require('path');

const W = 1800, H = 900;
const FONT = 'Inter, system-ui, -apple-system, sans-serif';

const out = [];
const p = (s) => out.push(s);
const pad = (n) => String(n).padStart(2, '0');

// Zone styling
const ZONES = {
  M: { fill: '#fdf4ff', stroke: '#a855f7', text: '#7e22ce', accent: '#c084fc', name: 'Mini Sklad' },
  D: { fill: '#fce7f3', stroke: '#ec4899', text: '#9d174d', accent: '#f472b6', name: 'D' },
  A: { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e40af', accent: '#60a5fa', name: 'A' },
  B: { fill: '#dcfce7', stroke: '#22c55e', text: '#166534', accent: '#4ade80', name: 'B' },
  C: { fill: '#fef3c7', stroke: '#f59e0b', text: '#92400e', accent: '#fbbf24', name: 'C' },
};

// =========================================================
// SVG START
// =========================================================
p(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
p(`  <defs>`);
// Gradients for zones
Object.entries(ZONES).forEach(([k, z]) => {
  p(`    <linearGradient id="grad-${k}" x1="0" y1="0" x2="0" y2="1">`);
  p(`      <stop offset="0%" stop-color="${z.fill}" stop-opacity="1"/>`);
  p(`      <stop offset="100%" stop-color="${z.fill}" stop-opacity="0.7"/>`);
  p(`    </linearGradient>`);
});
// Hatches
p(`    <pattern id="hatch-blocked" patternUnits="userSpaceOnUse" width="6" height="6">`);
p(`      <rect width="6" height="6" fill="#f8fafc"/>`);
p(`      <path d="M0,6 l6,-6 M-1.5,1.5 l3,-3 M4.5,7.5 l3,-3" stroke="#e2e8f0" stroke-width="1.2"/>`);
p(`    </pattern>`);
p(`    <pattern id="hatch-office" patternUnits="userSpaceOnUse" width="10" height="10">`);
p(`      <rect width="10" height="10" fill="#f1f5f9"/>`);
p(`      <path d="M0,10 l10,-10 M-2.5,2.5 l5,-5 M7.5,12.5 l5,-5" stroke="#cbd5e1" stroke-width="1.5"/>`);
p(`    </pattern>`);
p(`    <pattern id="hatch-corridor" patternUnits="userSpaceOnUse" width="8" height="8">`);
p(`      <rect width="8" height="8" fill="#ecfeff"/>`);
p(`      <circle cx="4" cy="4" r="1" fill="#67e8f9"/>`);
p(`    </pattern>`);
// Shadows & effects
p(`    <filter id="shadow-sm" x="-20%" y="-20%" width="140%" height="140%">`);
p(`      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.15"/>`);
p(`    </filter>`);
p(`    <filter id="shadow-lg" x="-30%" y="-30%" width="160%" height="160%">`);
p(`      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#0f172a" flood-opacity="0.2"/>`);
p(`    </filter>`);
p(`    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">`);
p(`      <feGaussianBlur stdDeviation="3" result="blur"/>`);
p(`      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>`);
p(`    </filter>`);
p(`  </defs>`);

// Background
p(`  <rect width="${W}" height="${H}" fill="#f8fafc"/>`);
// Subtle grid pattern
p(`  <g opacity="0.4">`);
for (let i = 0; i <= W; i += 40) p(`    <line x1="${i}" y1="0" x2="${i}" y2="${H}" stroke="#e2e8f0" stroke-width="0.5"/>`);
for (let i = 0; i <= H; i += 40) p(`    <line x1="0" y1="${i}" x2="${W}" y2="${i}" stroke="#e2e8f0" stroke-width="0.5"/>`);
p(`  </g>`);

// Main floor area
const floorX = 30, floorY = 80, floorW = W - 60, floorH = H - 130;
p(`  <rect x="${floorX}" y="${floorY}" width="${floorW}" height="${floorH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" rx="16" filter="url(#shadow-sm)"/>`);

// Title
p(`  <text x="${W/2}" y="40" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="800" fill="#0f172a" letter-spacing="1">ETILOG SKLAD</text>`);
p(`  <text x="${W/2}" y="62" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="500" fill="#64748b" letter-spacing="2">INTERAKTÍVNA MAPA PALETOVÝCH MIEST</text>`);

// Layout constants
const pad1 = 20;
const planX0 = floorX + pad1;
const planY0 = floorY + pad1;
const planX1 = floorX + floorW - pad1;
const planY1 = floorY + floorH - pad1;

// OFFICE area width (right side)
const officeW = 80;
const officeX = planX1 - officeW;

// Corridor widths
const corridorW = 42;

// Left column (Mini Sklad on top + Zone D below) - stacked in ONE column
const leftColW = 78;
const leftColX = planX0;

// Left vertical corridor (right of D column)
const leftCorridorX = leftColX + leftColW;
const dX = leftColX; // alias for compatibility

// Right corridor (before office)
const rightCorridorX = officeX - corridorW;

// Main bands area
const mainX0 = leftCorridorX + corridorW + 8;
const mainX1 = rightCorridorX - 8;
const mainW = mainX1 - mainX0;

// Band heights
const bandGap = 38;
const numBands = 3;
const bandAvail = (planY1 - planY0) - bandGap * 2;
const bandH = bandAvail / numBands;

const bandAY = planY0;
const bandBY = bandAY + bandH + bandGap;
const bandCY = bandBY + bandH + bandGap;

// =========================================================
// CORRIDORS (draw first, behind everything)
// =========================================================
p(`  <g id="corridors">`);

// Left vertical corridor (between Mini Sklad/D and main zones)
p(`    <rect x="${leftCorridorX}" y="${planY0}" width="${corridorW}" height="${planY1 - planY0}" fill="url(#hatch-corridor)" stroke="#22d3ee" stroke-width="1.5" stroke-dasharray="8,4" rx="6"/>`);
p(`    <text x="${leftCorridorX + corridorW/2}" y="${(planY0 + planY1)/2}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#0891b2" letter-spacing="1" transform="rotate(-90 ${leftCorridorX + corridorW/2} ${(planY0 + planY1)/2})">MANIPULAČNÁ CESTA</text>`);

// Right vertical corridor (before office)
p(`    <rect x="${rightCorridorX}" y="${planY0}" width="${corridorW}" height="${planY1 - planY0}" fill="url(#hatch-corridor)" stroke="#22d3ee" stroke-width="1.5" stroke-dasharray="8,4" rx="6"/>`);
p(`    <text x="${rightCorridorX + corridorW/2}" y="${(planY0 + planY1)/2}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#0891b2" letter-spacing="1" transform="rotate(-90 ${rightCorridorX + corridorW/2} ${(planY0 + planY1)/2})">MANIPULAČNÁ CESTA</text>`);

// Horizontal corridors between bands
const hCorrY1 = bandAY + bandH + 3;
const hCorrY2 = bandBY + bandH + 3;
const hCorrH = bandGap - 6;
p(`    <rect x="${mainX0 - 4}" y="${hCorrY1}" width="${mainW + 8}" height="${hCorrH}" fill="url(#hatch-corridor)" stroke="#22d3ee" stroke-width="1.5" stroke-dasharray="8,4" rx="5"/>`);
p(`    <text x="${mainX0 + mainW/2}" y="${hCorrY1 + hCorrH/2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#0891b2" letter-spacing="2">MANIPULAČNÁ CESTA</text>`);
p(`    <rect x="${mainX0 - 4}" y="${hCorrY2}" width="${mainW + 8}" height="${hCorrH}" fill="url(#hatch-corridor)" stroke="#22d3ee" stroke-width="1.5" stroke-dasharray="8,4" rx="5"/>`);
p(`    <text x="${mainX0 + mainW/2}" y="${hCorrY2 + hCorrH/2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="#0891b2" letter-spacing="2">MANIPULAČNÁ CESTA</text>`);

p(`  </g>`);

// =========================================================
// OFFICE AREA
// =========================================================
p(`  <g id="office">`);
p(`    <rect x="${officeX}" y="${planY0}" width="${officeW}" height="${planY1 - planY0}" fill="url(#hatch-office)" stroke="#94a3b8" stroke-width="2" rx="8"/>`);
p(`    <text x="${officeX + officeW/2}" y="${(planY0 + planY1)/2}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#475569" letter-spacing="1" transform="rotate(-90 ${officeX + officeW/2} ${(planY0 + planY1)/2})">KONŠTRUKTÉRI + TECHNOLOGIČKY</text>`);
p(`  </g>`);

// =========================================================
// LEFT COLUMN: MINI SKLAD (top) + ZONE D (below), stacked
// =========================================================
const mZ = ZONES.M;
const dZ = ZONES.D;

// Mini Sklad block height (top portion of left column)
const miniH = 90;
const miniBlockX = leftColX;
const miniBlockY = planY0;

// --- MINI SKLAD (own interactive zone, 1 field) ---
p(`  <g id="zone-Mini">`);
p(`    <rect x="${miniBlockX}" y="${miniBlockY}" width="${leftColW}" height="${miniH}" fill="url(#grad-M)" stroke="${mZ.stroke}" stroke-width="2" rx="10"/>`);
// Label
p(`    <text x="${miniBlockX + leftColW/2}" y="${miniBlockY + 18}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${mZ.text}" letter-spacing="0.5">MINI SKLAD</text>`);
// Single interactive field
p(`    <g class="loc-group">`);
p(`      <rect id="loc-MINI-01" class="pallet-loc" data-zone="MINI" data-num="1" x="${miniBlockX + 8}" y="${miniBlockY + 26}" width="${leftColW - 16}" height="${miniH - 36}" rx="6" fill="#faf5ff" stroke="${mZ.stroke}" stroke-width="1.5" stroke-dasharray="5,3"/>`);
p(`      <text x="${miniBlockX + leftColW/2}" y="${miniBlockY + miniH/2 + 14}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${mZ.text}" font-weight="600" pointer-events="none">Bežné veci</text>`);
p(`    </g>`);
p(`  </g>`);

// --- ZONE D (vertical strip below Mini Sklad, 20 locations) ---
const dBlockY = miniBlockY + miniH + 12;
const dBlockH = planY1 - dBlockY;
p(`  <g id="zone-D">`);
// Background
p(`    <rect x="${leftColX}" y="${dBlockY}" width="${leftColW}" height="${dBlockH}" fill="url(#grad-D)" stroke="${dZ.stroke}" stroke-width="2" rx="10"/>`);
// Zone label badge (prominent, top of D)
const dlx = leftColX + leftColW/2, dly = dBlockY + 22;
p(`    <rect x="${dlx - 22}" y="${dly - 16}" width="44" height="28" rx="14" fill="${dZ.stroke}" filter="url(#shadow-sm)"/>`);
p(`    <text x="${dlx}" y="${dly + 5}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="900" fill="#ffffff">D</text>`);
// Cells
const dCellsY0 = dBlockY + 42;
const dCellH = (planY1 - dCellsY0 - 8) / 20;
for (let i = 1; i <= 20; i++) {
  const cy = dCellsY0 + (i - 1) * dCellH;
  p(`    <g class="loc-group">`);
  p(`      <rect id="loc-D-${pad(i)}" class="pallet-loc" data-zone="D" data-num="${i}" x="${leftColX + 6}" y="${cy + 1}" width="${leftColW - 12}" height="${dCellH - 3}" rx="4" fill="#fdf2f8" stroke="${dZ.stroke}" stroke-width="1.2"/>`);
  p(`      <text x="${leftColX + leftColW/2}" y="${cy + dCellH/2 + 5}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="${dZ.text}" pointer-events="none">${i}</text>`);
  p(`    </g>`);
}
p(`  </g>`);

// =========================================================
// HORIZONTAL BANDS (A, B, C)
// =========================================================
function drawHorizontalBand(zone, y, h, sections, pillars, blocked) {
  const z = ZONES[zone];
  p(`  <g id="zone-${zone}">`);

  // Zone background with rounded corners
  p(`    <rect x="${mainX0 - 6}" y="${y - 2}" width="${mainW + 12}" height="${h + 4}" fill="url(#grad-${zone})" stroke="${z.stroke}" stroke-width="2" rx="10"/>`);

  // Calculate cell width
  const totalCells = sections.reduce((a, s) => a + (s.to - s.from + 1), 0);
  const corridorsBetween = sections.length - 1;
  const innerCorridorW = 28;
  const blockedW = 28;
  const blockedCount = (blocked || []).length;
  const cellsW = mainW - innerCorridorW * corridorsBetween - blockedW * blockedCount;
  const cw = cellsW / totalCells;

  let x = mainX0;
  sections.forEach((sec, si) => {
    for (let n = sec.from; n <= sec.to; n++) {
      // Blocked spot?
      const bk = (blocked || []).find(b => b.before === n);
      if (bk) {
        // Unused spot with pillar + first aid
        p(`      <g class="blocked-spot">`);
        p(`        <rect x="${x}" y="${y + 4}" width="${blockedW}" height="${h - 8}" rx="4" fill="url(#hatch-blocked)" stroke="#94a3b8" stroke-width="1.2"/>`);
        p(`        <rect x="${x + blockedW/2 - 5}" y="${y + h/2 - 18}" width="10" height="10" rx="2" fill="#64748b"/>`);
        // First aid cross
        const fax = x + blockedW/2, fay = y + h/2 + 6;
        p(`        <rect x="${fax - 8}" y="${fay - 8}" width="16" height="16" rx="3" fill="#dc2626"/>`);
        p(`        <rect x="${fax - 1.5}" y="${fay - 5}" width="3" height="10" fill="#fff"/>`);
        p(`        <rect x="${fax - 5}" y="${fay - 1.5}" width="10" height="3" fill="#fff"/>`);
        p(`      </g>`);
        x += blockedW;
      }

      // Regular cell
      const hasPillar = pillars && pillars.includes(n);
      p(`      <g class="loc-group">`);
      p(`        <rect id="loc-${zone}-${pad(n)}" class="pallet-loc" data-zone="${zone}" data-num="${n}" x="${x + 1}" y="${y + 4}" width="${cw - 2}" height="${h - 8}" rx="4" fill="${z.fill}" stroke="${z.stroke}" stroke-width="1.2"/>`);
      p(`        <text x="${x + cw/2}" y="${y + 20}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="${z.text}" pointer-events="none">${n}</text>`);
      if (hasPillar) {
        p(`        <rect class="pillar" x="${x + cw/2 - 5}" y="${y + h/2 - 2}" width="10" height="10" rx="2" fill="#64748b" stroke="#475569" stroke-width="0.8"/>`);
      }
      p(`      </g>`);
      x += cw;
    }
    // Inner corridor between sections
    if (si < sections.length - 1) {
      p(`      <rect x="${x + 2}" y="${y + 4}" width="${innerCorridorW - 4}" height="${h - 8}" fill="url(#hatch-corridor)" stroke="#22d3ee" stroke-width="1" stroke-dasharray="5,3" rx="4"/>`);
      x += innerCorridorW;
    }
  });

  // Zone label badge (centered, prominent) - draw LAST so it's on top of cells
  const labelX = mainX0 + mainW / 2;
  const labelY = y + h / 2;
  p(`    <rect x="${labelX - 30}" y="${labelY - 22}" width="60" height="44" rx="22" fill="${z.stroke}" filter="url(#shadow-lg)" opacity="0.95"/>`);
  p(`    <text x="${labelX}" y="${labelY + 12}" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="900" fill="#ffffff" filter="url(#glow)">${zone}</text>`);

  p(`  </g>`);
}

// Zone A: 1-22 | 23-32, pillars 6,18,27
drawHorizontalBand('A', bandAY, bandH, [{ from: 1, to: 22 }, { from: 23, to: 32 }], [6, 18, 27], []);

// Zone B: 1-22 | 23-32, blocked between 5-6, 17-18, 27-28
drawHorizontalBand('B', bandBY, bandH, [{ from: 1, to: 22 }, { from: 23, to: 32 }], [], [
  { before: 6 },
  { before: 18 },
  { before: 28 }
]);

// Zone C: 1-34 continuous, pillars 6,18,30
drawHorizontalBand('C', bandCY, bandH, [{ from: 1, to: 34 }], [6, 18, 30], []);

// =========================================================
// LEGEND
// =========================================================
const lgW = 700, lgH = 50;
const lgX = (W - lgW) / 2, lgY = H - 55;
p(`  <g id="legend">`);
p(`    <rect x="${lgX}" y="${lgY}" width="${lgW}" height="${lgH}" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" rx="10" filter="url(#shadow-sm)"/>`);

let lx = lgX + 20;
const legendItem = (color, stroke, label, width, pattern) => {
  const fill = pattern || color;
  p(`    <rect x="${lx}" y="${lgY + lgH/2 - 8}" width="22" height="16" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`);
  p(`    <text x="${lx + 30}" y="${lgY + lgH/2 + 4}" font-family="${FONT}" font-size="11" fill="#475569">${label}</text>`);
  lx += width;
};

legendItem('#dbeafe', '#3b82f6', 'Paletové miesto', 130);
legendItem('#64748b', '#475569', 'Stĺp (použiteľné)', 130);
legendItem('url(#hatch-blocked)', '#94a3b8', 'Nepoužívané + lekárnička', 175);
legendItem('url(#hatch-corridor)', '#22d3ee', 'Manipulačná cesta', 145);
legendItem('url(#hatch-office)', '#94a3b8', 'Kancelárie', 100);

p(`  </g>`);

// =========================================================
// INTERACTIVE STYLES
// =========================================================
p(`  <style>`);
p(`    .pallet-loc { cursor: pointer; transition: all .15s ease; }`);
p(`    .loc-group:hover .pallet-loc { stroke-width: 2.5; filter: url(#shadow-lg); transform-origin: center; }`);
p(`    .pillar, .blocked-spot { pointer-events: none; }`);
p(`    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }`);
p(`    .pallet-loc.highlight { animation: pulse 0.8s ease-in-out infinite; stroke-width: 3; }`);
p(`  </style>`);

p(`</svg>`);

// Write output
const svg = out.join('\n');
const target = path.join(__dirname, '..', 'public', 'portal', 'assets', 'images', 'warehouse-map.svg');
fs.writeFileSync(target, svg, 'utf8');
console.log(`✓ Warehouse SVG v2 written: ${target}`);
console.log(`  Size: ${(svg.length / 1024).toFixed(1)} KB`);
console.log(`  Zones: Mini Sklad (1), D (20), A (32), B (32), C (34) = 119 locations`);
