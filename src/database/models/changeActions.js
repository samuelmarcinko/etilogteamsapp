/**
 * Čo smie stáť v `production_change_log.action`.
 *
 * Ten istý zoznam je aj v databáze ako obmedzenie `chk_change_action`. Dva
 * zoznamy na tú istú vec sú zvyčajne chyba - tu sú zámerne, lebo každý z nich
 * robí niečo iné: databáza zápis odmietne, a tento súbor existuje preto, aby
 * sa dalo overiť, že sa tie dva nerozišli.
 *
 * Rozišli sa raz a stálo to funkciu. Migrácia 034 pridávala `discarded` a
 * `discard_undone`, obmedzenie prepísala nanovo a zoznam opísala z migrácie
 * 026 namiesto 027 - čím z neho vypadli poznámky k smenám. Zápis do denníka
 * ide v tej istej transakcii ako samotná poznámka, takže sa poznámka k smene
 * prestala dať uložiť úplne a plánovač dostal na obrazovku hlášku z databázy.
 * Nikto si toho nevšimol, kým to nikto neskúsil.
 *
 * `scripts/test-production-change-actions.js` skúša každú hodnotu odtiaľto
 * zapísať do skutočnej databázy. Ďalšia migrácia, ktorá na niektorú zabudne,
 * tak spadne na teste a nie pod rukami plánovača.
 */

const CHANGE_ACTIONS = [
  'created',
  'updated',
  'moved',
  'deleted',
  'restored',
  'unscheduled',
  'scheduled',
  // Príznaky dní sa dnes do denníka nelogujú. Hodnoty zostávajú povolené,
  // lebo v starých riadkoch byť môžu a odobratie by nič nezískalo.
  'day_flag_set',
  'day_flag_cleared',
  'shift_note_set',
  'shift_note_cleared',
  'discarded',
  'discard_undone'
];

module.exports = { CHANGE_ACTIONS };
