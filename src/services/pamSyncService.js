const cron = require('node-cron');
const { PamClient, PamError } = require('./pamClient');
const Quota = require('../database/models/Quota');
const User = require('../database/models/User');
const logger = require('../utils/logger');

/**
 * Kvóty zo SOFTIP PAM.
 *
 * Kto počíta, ten je pánom čísla. PAM vie, čo mzdová učtáreň spracovala;
 * appka vie, čo šéf schválil. Obe čísla sú správne a obe sú iné - preto sa
 * nezlučujú, ale stoja vedľa seba a zobrazuje sa rozdiel.
 *
 * Mapovanie, overené na skutočných dátach (Martin Zborovjan, os. č. 412):
 *
 *   NÁROK NA DOVOLENKU   z_dovolenka, jeden riadok na rok, vybraný podľa
 *                        roku v dov_d_od. Nárok je súčet piatich stĺpcov:
 *                        dov_stara (prenos z minulého roka) + dov_nova
 *                        (nárok za tento rok) + dodatková, osobitná
 *                        dodatková a ďalšia. V dňoch.
 *                        2026: 18,50 + 25,00 = 43,50.
 *
 *   ČERPANIE             z_vysl_brutto, súčet vysb_hodiny za rok podľa
 *                        mzdovej zložky. V HODINÁCH, aj dovolenka.
 *                        2026: 401 = 60, 402 = 148, 561 = 31,75, 563 = 8.
 *
 * Kontrolný súčet, ktorý to celé potvrdil: (60 + 148) / 8 = 26 dní
 * dovolenky, 43,50 - 26 = 17,50 - presne to, čo appka ukazuje dnes.
 * Paragrafy: 56 - 31,75 = 24,25 a 56 - 8 = 48.
 *
 * Nárok na paragrafy PAM nevedie, ten je zo zákona (7 dní = 56 hodín) a
 * zostáva tam, kde je dnes. Odtiaľto prichádza len čerpanie.
 */

// Všetci interní zamestnanci sú na plný úväzok, takže jeden deň je osem
// hodín. Keby raz pribudol kratší úväzok, toto je to miesto, kde sa to
// prejaví - a bude to treba vziať z PAM, nie odhadnúť.
const HOURS_PER_DAY = 8;

// Mzdové zložky. Dovolenka sa vykazuje viacerými kódmi (riadna, krátená,
// náhrada...), paragrafy jedným každý. Presné popisy sú v
// z_prvok_pam_param; tu sú kódy zámerne vymenované, aby bolo na prvý
// pohľad vidieť, čo sa do kvóty počíta a čo nie.
const CODES = {
  vacation: [401, 402, 403, 404, 405],
  paragraph: [561],   // Paragraf - lekár
  ocr: [563]          // Paragraf - sprievod
};

const ALL_CODES = [...CODES.vacation, ...CODES.paragraph, ...CODES.ocr];

/** Čo PAM o človeku nevie povedať. Volajúci to má ukázať, nie spolknúť. */
class PamLookupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PamLookupError';
    this.code = code;
  }
}

class PamSyncService {
  constructor(client = PamClient.shared()) {
    this.client = client;
    this.cronJob = null;
    this.lastRun = null;
  }

  /**
   * Ranný beh o 05:45.
   *
   * Po tom, čo mzdová učtáreň spracuje nočné dávky, a pred tým, než si
   * ľudia sadnú k počítačom. Kolegyňa tak ráno vidí stav, ktorý sedí s PAM.
   *
   * Nie o 05:30, hoci by to inak sedelo: v tú minútu beží skladová
   * synchronizácia so SAPom a obe by si ťahali ten istý VPN tunel na
   * 192.168.18.41. Nič by sa nepokazilo, len by sa navzájom spomaľovali.
   *
   * Bez nastaveného PAM_DB_* sa neplánuje nič. Nasadenie, ktoré o PAM
   * nevie, sa má správať presne ako doteraz.
   */
  start() {
    const reason = PamClient.misconfigured;
    if (reason) {
      logger.info('PAM sync not scheduled', { reason });
      return;
    }

    this.cronJob = cron.schedule('45 5 * * *', () => {
      this.syncAll()
        .then((summary) => { this.lastRun = { at: new Date().toISOString(), ...summary }; })
        .catch((error) => {
          this.lastRun = { at: new Date().toISOString(), error: error.message };
          logger.error('PAM sync failed', { error: error.message });
        });
    });
    logger.info('PAM sync service started', { schedule: 'daily at 05:45', ...PamClient.target });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  /**
   * Meno, pod ktorým osobné číslo vedie PAM.
   *
   * Kvôli tomu, aby kolegyňa pri synchronizácii videla, koho vlastne
   * spárovala. Preklep v osobnom čísle inak nemá ako vyjsť najavo - kvóty
   * by sa natiahli, boli by to platné čísla, len by patrili niekomu inému.
   *
   * Človek môže mať v z_identifikacia viac záznamov (zmena priezviska), tak
   * sa berie ten s najneskorším koncom platnosti - aktuálny má ido_d_do
   * ďaleko v budúcnosti.
   */
  async identify(personalNumber) {
    const rows = await this.client.query(
      `SELECT TOP (1) ido_meno AS meno, ido_priezvisko AS priezvisko
         FROM dbo.z_identifikacia
        WHERE osu_os_cis = @osobne
        ORDER BY ido_d_do DESC, ido_d_od DESC`,
      { osobne: personalNumber }
    );

    if (!rows.length) {
      throw new PamLookupError(
        `Osobné číslo ${personalNumber} sa v PAM nenašlo.`,
        'unknown_personal_number'
      );
    }

    const { meno, priezvisko } = rows[0];
    return [meno, priezvisko].filter(Boolean).join(' ').trim() || null;
  }

  /**
   * Nárok na dovolenku za rok, v dňoch.
   *
   * Riadkov má byť na rok práve jeden. Keby ich bolo viac - napríklad pri
   * dvoch pracovných pomeroch - sčítajú sa, ale volajúci sa o tom dozvie.
   * Tiché sčítanie by niekomu zdvojilo kvótu a na obrazovke by to vyzeralo
   * úplne normálne.
   */
  async vacationEntitlement(personalNumber, year) {
    const rows = await this.client.query(
      `SELECT COUNT(*) AS riadkov,
              SUM(COALESCE(dov_stara, 0) + COALESCE(dov_nova, 0)
                + COALESCE(dov_dodat, 0) + COALESCE(dov_os_dod, 0)
                + COALESCE(dov_dal, 0)) AS narok
         FROM dbo.z_dovolenka
        WHERE osu_os_cis = @osobne
          AND YEAR(dov_d_od) = @rok`,
      { osobne: personalNumber, rok: year }
    );

    const row = rows[0] || {};
    const count = Number(row.riadkov || 0);

    if (!count) {
      throw new PamLookupError(
        `PAM nemá pre osobné číslo ${personalNumber} nárok na dovolenku za rok ${year}.`,
        'no_entitlement'
      );
    }

    return { days: Number(row.narok || 0), rows: count };
  }

  /**
   * Čerpanie za rok, po mzdových zložkách. Vracia hodiny.
   *
   * Žiadny riadok znamená, že človek ešte nič nečerpal - to je platná
   * odpoveď, nie chyba. Preto sa chýbajúce kódy dopĺňajú nulou tu a nie
   * až niekde v zobrazení.
   */
  async usage(personalNumber, year) {
    const rows = await this.client.query(
      `SELECT prvok_kod AS kod, SUM(vysb_hodiny) AS hodiny
         FROM dbo.z_vysl_brutto
        WHERE osu_os_cis = @osobne
          AND vysb_rok = @rok
          AND prvok_kod IN (${ALL_CODES.join(',')})
        GROUP BY prvok_kod`,
      { osobne: personalNumber, rok: year }
    );

    const byCode = new Map(rows.map((r) => [Number(r.kod), Number(r.hodiny || 0)]));
    const sum = (codes) => codes.reduce((total, code) => total + (byCode.get(code) || 0), 0);

    return {
      vacationHours: sum(CODES.vacation),
      paragraphHours: sum(CODES.paragraph),
      ocrHours: sum(CODES.ocr)
    };
  }

  /**
   * Posledný mesiac, za ktorý má PAM spracované mzdy.
   *
   * Zámerne cez všetky mzdové zložky, nielen cez dovolenku a paragrafy:
   * kto si v septembri nevzal voľno, nemá za september riadok s dovolenkou,
   * ale výplatu dostal. Keby sa počítalo len z našich kódov, jeho septembrová
   * žiadosť by zostala navždy označená ako nespracovaná.
   *
   * Vráti null, keď za ten rok nie je nič - vtedy je nespracované všetko,
   * čo je správne.
   */
  async lastProcessedMonth(personalNumber, year) {
    const rows = await this.client.query(
      `SELECT MAX(vysb_mes) AS mesiac
         FROM dbo.z_vysl_brutto
        WHERE osu_os_cis = @osobne AND vysb_rok = @rok`,
      { osobne: personalNumber, rok: year }
    );
    const month = rows[0]?.mesiac;
    return month == null ? null : Number(month);
  }

  /**
   * Všetko, čo PAM o jednom človeku za jeden rok povie.
   *
   * Nič nezapisuje - len číta a prepočíta. Zápis je vedome o úroveň vyššie,
   * aby sa dalo pozrieť, čo by sa uložilo, bez toho, aby sa to uložilo.
   */
  async read(personalNumber, year) {
    const name = await this.identify(personalNumber);
    const entitlement = await this.vacationEntitlement(personalNumber, year);
    const used = await this.usage(personalNumber, year);
    const lastMonth = await this.lastProcessedMonth(personalNumber, year);

    return {
      personalNumber,
      year,
      name,
      lastMonth,
      // Dovolenka sa v appke vedie v dňoch, PAM ju čerpá v hodinách.
      vacationTotal: entitlement.days,
      vacationUsed: used.vacationHours / HOURS_PER_DAY,
      // Paragrafy zostávajú v hodinách na oboch stranách, neprepočítava sa nič.
      paragraphUsed: used.paragraphHours,
      ocrUsed: used.ocrHours,
      entitlementRows: entitlement.rows
    };
  }

  /**
   * Prečíta z PAM a uloží k človeku. Ručných hodnôt sa nedotýka.
   *
   * Externý sa odmietne vedome a nahlas: v PAM nie je, takže by sa buď
   * nenašiel, alebo - horšie - našiel by sa niekto cudzí pod tým istým
   * číslom.
   */
  async syncUser(user, year = new Date().getFullYear()) {
    if (user.is_external) {
      throw new PamLookupError(
        `${user.display_name || user.user_id} je označený ako externý pracovník, v PAM nie je.`,
        'external'
      );
    }
    if (user.personal_number == null) {
      throw new PamLookupError(
        `${user.display_name || user.user_id} nemá zadané osobné číslo.`,
        'unmapped'
      );
    }

    const fromPam = await this.read(user.personal_number, year);

    await Quota.setPamValues(user.user_id, year, {
      vacationTotal: fromPam.vacationTotal,
      vacationUsed: fromPam.vacationUsed,
      paragraphUsed: fromPam.paragraphUsed,
      ocrUsed: fromPam.ocrUsed,
      lastMonth: fromPam.lastMonth
    });

    if (fromPam.entitlementRows > 1) {
      logger.warn('PAM: more than one entitlement row for one year', {
        userId: user.user_id,
        personalNumber: user.personal_number,
        year,
        rows: fromPam.entitlementRows
      });
    }

    return fromPam;
  }

  /**
   * Nočný beh: všetci interní so zadaným osobným číslom.
   *
   * Jeden človek nesmie zhodiť celý beh. Keď niekomu chýba v PAM nárok,
   * ostatní sa dosynchronizujú a jeho dôvod sa vráti v zozname - tam sa
   * dá ukázať kolegyni, nech to opraví.
   *
   * Keď je PAM nedostupný, prestane sa hneď po prvom človeku. Tridsať
   * pätnásťsekundových čakaní na spojenie, ktoré neexistuje, by trvalo
   * osem minút a nezistili by sme nimi nič nové.
   */
  async syncAll(year = new Date().getFullYear()) {
    const users = await User.findPamMapped();
    const started = Date.now();
    const done = [];
    const failed = [];

    for (const user of users) {
      try {
        const result = await this.syncUser(user, year);
        done.push({ userId: user.user_id, name: user.display_name, pamName: result.name });
      } catch (error) {
        failed.push({
          userId: user.user_id,
          name: user.display_name,
          reason: error.message,
          code: error.code || null
        });

        if (error instanceof PamError) {
          logger.error('PAM sync stopped - database unreachable', { error: error.message });
          break;
        }
      }
    }

    const summary = {
      year,
      considered: users.length,
      synced: done.length,
      failed: failed.length,
      ms: Date.now() - started,
      problems: failed
    };
    logger.info('PAM sync finished', { ...summary, problems: failed.length });
    return summary;
  }

  static shared() {
    if (!PamSyncService._shared) PamSyncService._shared = new PamSyncService();
    return PamSyncService._shared;
  }
}

module.exports = { PamSyncService, PamLookupError, HOURS_PER_DAY, CODES };
