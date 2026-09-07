#!/usr/bin/env node
/**
 * Premenovanie poznámkových riadkov, ktoré majú kód projektu.
 *
 * Tašky a police k projektu FG100875 boli zapísané pod kódom `FG100875`, hoci
 * projekt skladovou položkou nie je. Kým kód takto vyzerá, každé porovnanie a
 * každá synchronizácia si ho vypýta zo SAPu, dostane nulu a bude hlásiť rozdiel
 * na tovare, ktorý žiadnym rozdielom nie je.
 *
 *     FG100875 / Tasky   →   (bez kódu) / Tašky – FG100875   · projekt FG100875
 *
 * Kód sa nenahrádza, ale ZAHADZUJE. Vymyslieť náhradu ako `TASKY-FG100875` by
 * znamenalo dať poznámke identifikátor, ktorý neexistuje nikde - a prvý, kto ho
 * uvidí v stĺpci „Kód", ho pôjde hľadať do SAPu. Poznámka nesie dve veci: ku
 * ktorému projektu patrí a čo to je. Obe majú svoj stĺpec.
 *
 * Pôvodný kód aj názov sa odkladajú do `legacy_code` a `legacy_name`, takže
 * návrat je jeden UPDATE a nie obnova celej databázy.
 *
 * Počty ani paletové pozície sa nemenia. Vôbec.
 *
 * Spustenie - najprv nasucho, vypíše čo by urobil a nič nezmení:
 *
 *   docker exec teams-app node scripts/rename-project-materials.js
 *   docker exec teams-app node scripts/rename-project-materials.js --apply
 */
const pool = require('../src/database/config');

/** Kategórie, ktoré skladníci naozaj písali. */
const CATEGORIES = [
  { prefix: 'TASKY', label: 'Tašky', match: /tašk|tasky|taška/i },
  { prefix: 'POLICE', label: 'Police', match: /polic/i },
  { prefix: 'BOCNICE', label: 'Bočnice', match: /bocnic|bočnic/i },
  { prefix: 'DOKUMENTY', label: 'Dokumentovky', match: /dokumentov/i }
];

/**
 * Z čoho sa skladá nový kód.
 *
 * Podľa slova, ktoré je v názve PRVÉ, nie podľa poradia v tomto zozname.
 * „Police Tasky" je predovšetkým police; keby sa hľadalo najprv „tašky",
 * dostal by riadok kód TASKY a názov o policiach, čo by si protirečilo.
 */
function categoryFor(name) {
  const text = String(name || '');
  let best = null;
  for (const category of CATEGORIES) {
    const at = text.search(category.match);
    if (at >= 0 && (best === null || at < best.at)) best = { ...category, at };
  }
  return best;
}

function prefixFor(name) {
  return categoryFor(name)?.prefix || 'POZN';
}

/**
 * Nový názov: „Tašky – FG100875".
 *
 * Ak je pôvodný názov holá kategória („Tasky", „TASKY", „Police"), nahradí sa -
 * nenesie nič, čo by sa dalo stratiť. Ak nesie čokoľvek navyše, ZOSTÁVA a
 * pripojí sa mu len projekt: „Police HKP" je police pre HKP a „Police Tasky"
 * sú na dvoch pozíciách police aj tašky. Prepísať ich na holé „Police" by
 * zahodilo presne to, kvôli čomu si skladník ten riadok zakladal.
 *
 * Pomlčka je dlhá, lebo spája dve veci, nie slová.
 */
function nameFor(name, fg) {
  const category = categoryFor(name);
  const bare = String(name || '').trim().toLowerCase();
  const isJustCategory = category
    && bare.replace(/[^a-zá-ž]/gi, '').length <= category.label.length + 1;

  const label = isJustCategory ? category.label : String(name || '').trim();
  return `${label || 'Poznámka'} – ${fg}`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const { rows } = await pool.query(
    `SELECT m.id, m.code, m.name, m.quantity, m.project_fg, m.legacy_code,
            (SELECT string_agg(pl.code, ', ' ORDER BY pl.code)
               FROM material_placements mp
               JOIN pallet_locations pl ON pl.id = mp.location_id
              WHERE mp.material_id = m.id) AS palety
       FROM materials m
      -- Kód musí ešte existovať: poznámka založená už novým formulárom žiadny
      -- nemá, takže na nej nie je čo premenovať. Bez tejto podmienky ju skript
      -- zoberie a spadne pri prvom výpise.
      WHERE m.deleted_at IS NULL AND m.kind = 'local'
        AND m.code IS NOT NULL AND m.legacy_code IS NULL
      ORDER BY m.code`
  );

  if (!rows.length) {
    console.log('Niet čo premenovať - buď sa to už spustilo, alebo žiadne vlastné položky nie sú.');
    return;
  }

  const plan = rows.map((row) => {
    const fg = (row.project_fg || row.code).toUpperCase();
    return { ...row, projectFg: fg, newName: nameFor(row.name, fg) };
  });

  console.log(`\n${apply ? 'Premenúvam' : 'Suchý beh - nič sa nemení'}: ${plan.length} riadkov\n`);
  console.log('kód       → kód   projekt     názov          → nový názov               ks  palety');
  console.log('─'.repeat(104));
  for (const row of plan) {
    console.log(
      `${row.code.padEnd(9)} →  —    ${row.projectFg.padEnd(11)}`
      + ` ${(row.name || '').slice(0, 14).padEnd(14)} → ${row.newName.slice(0, 24).padEnd(24)}`
      + ` ${String(row.quantity).padStart(3)}  ${row.palety || '—'}`
    );
  }

  if (!apply) {
    console.log('\nNič sa nezmenilo. Spusti znova s --apply, ak to takto sedí.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of plan) {
      await client.query(
        `UPDATE materials
            SET legacy_code = code, legacy_name = name,
                code = NULL, name = $2, project_fg = $3,
                sap_item_code = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [row.id, row.newName, row.projectFg]
      );
    }
    await client.query('COMMIT');
    console.log(`\nHotovo: ${plan.length} riadkov. Kód zahodený, projekt a názov ho nahradili.`);
    console.log('Počty ani palety sa nezmenili.');
    console.log('Návrat: UPDATE materials SET code = legacy_code, name = legacy_name'
      + ' WHERE legacy_code IS NOT NULL;');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

module.exports = { prefixFor, nameFor };
