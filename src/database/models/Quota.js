const pool = require('../config');

/** Typy, ktoré majú kvótu. Ostatné (nákup, výdavok...) sa jej netýkajú. */
const QUOTA_TYPES = ['vacation', 'paragraph', 'ocr'];

/** Ako sa typ volá v stĺpcoch. sick-leave má historicky iný prefix. */
const COLUMN_PREFIX = {
  'vacation': 'vacation',
  'sick-leave': 'sick',
  'paragraph': 'paragraph',
  'ocr': 'ocr'
};

class Quota {
  /**
   * Číta sa tomuto človeku kvóta z PAM?
   *
   * Musia platiť všetky tri veci naraz: nie je externý (externí v PAM nie
   * sú), má osobné číslo, a aspoň raz sa naozaj úspešne synchronizoval.
   *
   * To tretie je tu zámerne. Kolegyňa bude osobné čísla dopĺňať postupne a
   * samotné zadané číslo ešte nič neznamená - kým PAM neodpovedal, nemáme
   * čo zobraziť. Taký človek zostáva na ručných hodnotách a funguje presne
   * ako doteraz, namiesto toho, aby mu kvóta zhasla.
   */
  static readsFromPam(row) {
    return Boolean(row)
      && !row.is_external
      && row.personal_number != null
      && row.pam_synced_at != null;
  }

  /**
   * Čo je schválené a PAM to ešte nezapočítal, po ľuďoch a typoch.
   *
   * Kľúč je `userId|typ`, hodnota číslo v tej jednotke, v ktorej sa typ
   * vedie - dni pri dovolenke, hodiny pri paragrafoch.
   *
   * Žiadosť sa považuje za nespracovanú, keď je z mesiaca, ktorý PAM ešte
   * nemá uzavretý. Nie je to dokonalé - PAM nevie povedať „túto konkrétnu
   * žiadosť som započítal" - ale je to to najpresnejšie, čo sa z jeho dát
   * dá zistiť, a dá sa to vysvetliť jednou vetou: mzdy sú spracované do
   * augusta, tvoja žiadosť je zo septembra.
   *
   * Jeden dotaz za všetkých, lebo toto sa počíta aj pri zozname kvót celej
   * firmy naraz.
   */
  static async pendingByUser(year, userId = null) {
    const result = await pool.query(
      `SELECT t.created_by_id AS user_id,
              t.ticket_type,
              COALESCE(SUM(t.quota_amount), 0)::float8 AS amount
         FROM tickets t
         JOIN employee_quotas eq
           ON eq.user_id = t.created_by_id AND eq.year = $1
        WHERE t.status = 'Approved'
          AND t.ticket_type = ANY($2)
          AND t.start_date IS NOT NULL
          AND EXTRACT(YEAR FROM t.start_date) = $1
          AND EXTRACT(MONTH FROM t.start_date) > COALESCE(eq.pam_last_month, 0)
          AND ($3::varchar IS NULL OR t.created_by_id = $3)
        GROUP BY t.created_by_id, t.ticket_type`,
      [year, QUOTA_TYPES, userId]
    );

    return new Map(result.rows.map((r) => [`${r.user_id}|${r.ticket_type}`, Number(r.amount)]));
  }

  /**
   * Doplní riadok o to, čo sa má naozaj zobraziť.
   *
   * Pri človeku napojenom na PAM je zdrojom PAM: nárok na dovolenku aj
   * čerpanie prichádzajú odtiaľ. Nárok na paragrafy nie - ten PAM nevedie,
   * je zo zákona a zostáva taký, aký je nastavený v appke. Odtiaľ prichádza
   * len čerpanie.
   *
   * Zostatok je zámerne číslo PAM, nie číslo PAM zmenšené o nespracované.
   * Kolegyňa musí vidieť to isté, čo vidí v PAM, inak sa to nedá porovnať.
   * Čo je schválené navyše, stojí vedľa ako samostatný údaj - a práve to je
   * ten rozdiel, ktorý by inak nikto nevedel vysvetliť.
   */
  static withEffectiveValues(row, pending = new Map()) {
    const fromPam = Quota.readsFromPam(row);
    const at = (type) => pending.get(`${row.user_id}|${type}`) || 0;

    const total = {
      vacation: fromPam && row.pam_vacation_days_total != null
        ? Number(row.pam_vacation_days_total)
        : Number(row.vacation_days_total),
      // Nárok na paragrafy PAM nevedie - zo zákona, z nastavení appky.
      paragraph: Number(row.paragraph_days_total ?? 7),
      ocr: Number(row.ocr_days_total ?? 7),
      sick: Number(row.sick_days_total ?? 5)
    };

    const used = {
      vacation: fromPam && row.pam_vacation_days_used != null
        ? Number(row.pam_vacation_days_used)
        : Number(row.vacation_days_used || 0),
      paragraph: fromPam && row.pam_paragraph_days_used != null
        ? Number(row.pam_paragraph_days_used)
        : Number(row.paragraph_days_used || 0),
      ocr: fromPam && row.pam_ocr_days_used != null
        ? Number(row.pam_ocr_days_used)
        : Number(row.ocr_days_used || 0),
      sick: Number(row.sick_days_used || 0)
    };

    return {
      ...row,
      quota_source: fromPam ? 'pam' : 'manual',
      vacation_days_total: total.vacation,
      vacation_days_used: used.vacation,
      vacation_days_remaining: total.vacation - used.vacation,
      paragraph_days_total: total.paragraph,
      paragraph_days_used: used.paragraph,
      paragraph_days_remaining: total.paragraph - used.paragraph,
      ocr_days_total: total.ocr,
      ocr_days_used: used.ocr,
      ocr_days_remaining: total.ocr - used.ocr,
      sick_days_total: total.sick,
      sick_days_used: used.sick,
      sick_days_remaining: total.sick - used.sick,
      // Schválené, ešte nespracované. Pri ručnom zdroji je to nula: tam
      // appka odpočítava sama, takže nič nečaká.
      vacation_days_pending: fromPam ? at('vacation') : 0,
      paragraph_days_pending: fromPam ? at('paragraph') : 0,
      ocr_days_pending: fromPam ? at('ocr') : 0
    };
  }

  /**
   * Kvóta jedného človeka tak, ako sa má zobraziť - vrátane zdroja.
   *
   * Spája employee_quotas s párovaním na PAM, ktoré je na používateľovi.
   * Bez toho spojenia sa nedá povedať, odkiaľ sa čísla berú.
   */
  static async effective(userId, year) {
    await this.getOrCreate(userId, year);

    const { rows } = await pool.query(
      `SELECT eq.*, u.personal_number, COALESCE(u.is_external, false) AS is_external
         FROM employee_quotas eq
         JOIN users u ON u.user_id = eq.user_id
        WHERE eq.user_id = $1 AND eq.year = $2`,
      [userId, year]
    );
    if (!rows[0]) return null;

    return Quota.withEffectiveValues(rows[0], await Quota.pendingByUser(year, userId));
  }

  /**
   * Get or create quota for a user/year
   */
  static async getOrCreate(userId, year) {
    // First try to find existing
    let result = await pool.query(
      'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
      [userId, year]
    );

    if (result.rows[0]) {
      return result.rows[0];
    }

    // Get defaults from quota_settings
    const defaults = await pool.query(
      'SELECT * FROM quota_settings WHERE year = $1',
      [year]
    );

    const vacationDays = defaults.rows[0]?.default_vacation_days || 20;
    const sickDays = defaults.rows[0]?.default_sick_days || 5;
    const paragraphDays = defaults.rows[0]?.default_paragraph_days || 7;
    const ocrDays = defaults.rows[0]?.default_ocr_days || 7;

    result = await pool.query(
      `INSERT INTO employee_quotas (user_id, year, vacation_days_total, sick_days_total, paragraph_days_total, ocr_days_total)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, year) DO NOTHING
       RETURNING *`,
      [userId, year, vacationDays, sickDays, paragraphDays, ocrDays]
    );

    // In case of race condition, re-fetch
    if (!result.rows[0]) {
      result = await pool.query(
        'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
        [userId, year]
      );
    }

    return result.rows[0];
  }

  /**
   * Get quota for user/year
   */
  static async findByUserAndYear(userId, year) {
    const result = await pool.query(
      'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
      [userId, year]
    );
    return result.rows[0];
  }

  /**
   * Get all quotas for a year (admin view)
   * Shows ALL users, including those without quota records yet
   */
  static async findAllByYear(year) {
    // Get defaults from quota_settings
    const defaults = await pool.query(
      'SELECT * FROM quota_settings WHERE year = $1',
      [year]
    );
    const defVacation = defaults.rows[0]?.default_vacation_days || 20;
    const defSick = defaults.rows[0]?.default_sick_days || 5;
    const defParagraph = defaults.rows[0]?.default_paragraph_days || 7;
    const defOcr = defaults.rows[0]?.default_ocr_days || 7;

    const result = await pool.query(
      `SELECT
         u.user_id,
         u.display_name,
         u.email,
         COALESCE(eq.year, $1) as year,
         COALESCE(eq.vacation_days_total, $2) as vacation_days_total,
         COALESCE(eq.vacation_days_used, 0) as vacation_days_used,
         COALESCE(eq.sick_days_total, $3) as sick_days_total,
         COALESCE(eq.sick_days_used, 0) as sick_days_used,
         COALESCE(eq.paragraph_days_total, $4) as paragraph_days_total,
         COALESCE(eq.paragraph_days_used, 0) as paragraph_days_used,
         COALESCE(eq.ocr_days_total, $5) as ocr_days_total,
         COALESCE(eq.ocr_days_used, 0) as ocr_days_used,
         -- Párovanie na PAM. Bez neho sa riadok v zozname nedá odlíšiť od
         -- riadku človeka, ktorý v PAM nie je vôbec.
         u.personal_number,
         COALESCE(u.is_external, false) as is_external,
         -- Čo naposledy povedal PAM. V tichom behu stoja tieto hodnoty vedľa
         -- ručných a nič nimi zatiaľ nenahrádzame.
         eq.pam_vacation_days_total,
         eq.pam_vacation_days_used,
         eq.pam_paragraph_days_used,
         eq.pam_ocr_days_used,
         eq.pam_synced_at,
         eq.pam_last_month,
         CASE WHEN eq.user_id IS NULL THEN true ELSE false END as needs_initialization
       FROM users u
       LEFT JOIN employee_quotas eq ON u.user_id = eq.user_id AND eq.year = $1
       WHERE COALESCE(u.hidden, false) = false
       ORDER BY u.display_name`,
      [year, defVacation, defSick, defParagraph, defOcr]
    );
    return result.rows;
  }

  /**
   * Update quota totals (admin)
   */
  static async updateTotals(userId, year, vacationTotal, sickTotal, paragraphTotal, ocrTotal) {
    const result = await pool.query(
      `UPDATE employee_quotas
       SET vacation_days_total = $1, sick_days_total = $2,
           paragraph_days_total = COALESCE($5, paragraph_days_total),
           ocr_days_total = COALESCE($6, ocr_days_total),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $3 AND year = $4
       RETURNING *`,
      [vacationTotal, sickTotal, userId, year, paragraphTotal || null, ocrTotal || null]
    );
    return result.rows[0];
  }

  /**
   * Update quota totals AND used values (admin) - for manual adjustments
   */
  static async updateQuotaFull(userId, year, data) {
    const result = await pool.query(
      `UPDATE employee_quotas
       SET vacation_days_total = COALESCE($1, vacation_days_total),
           vacation_days_used = COALESCE($2, vacation_days_used),
           paragraph_days_total = COALESCE($3, paragraph_days_total),
           paragraph_days_used = COALESCE($4, paragraph_days_used),
           ocr_days_total = COALESCE($5, ocr_days_total),
           ocr_days_used = COALESCE($6, ocr_days_used),
           sick_days_total = COALESCE($7, sick_days_total),
           sick_days_used = COALESCE($8, sick_days_used),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $9 AND year = $10
       RETURNING *`,
      [
        data.vacation_days_total,
        data.vacation_days_used,
        data.paragraph_days_total,
        data.paragraph_days_used,
        data.ocr_days_total,
        data.ocr_days_used,
        data.sick_days_total,
        data.sick_days_used,
        userId,
        year
      ]
    );
    return result.rows[0];
  }

  /**
   * Zapíše, čo o človeku povie PAM. Ručných hodnôt sa nedotýka.
   *
   * Volá sa len vtedy, keď PAM naozaj odpovedal. Keď je VPN dole, nevolá sa
   * vôbec - staré hodnoty aj starý pam_synced_at zostanú ležať a na
   * obrazovke je rozdiel medzi "PAM hovorí nula" a "PAM sa dva dni neozval".
   * Keby sa to zapisovalo aj pri chybe, kvóta by sa niekomu tichučko
   * vynulovala a nikto by nevedel prečo.
   */
  static async setPamValues(userId, year, { vacationTotal, vacationUsed, paragraphUsed, ocrUsed, lastMonth = null }) {
    await this.getOrCreate(userId, year);

    const result = await pool.query(
      `UPDATE employee_quotas
          SET pam_vacation_days_total = $1,
              pam_vacation_days_used  = $2,
              pam_paragraph_days_used = $3,
              pam_ocr_days_used       = $4,
              pam_last_month          = $5,
              pam_synced_at           = CURRENT_TIMESTAMP,
              updated_at              = CURRENT_TIMESTAMP
        WHERE user_id = $6 AND year = $7
        RETURNING *`,
      [vacationTotal, vacationUsed, paragraphUsed, ocrUsed, lastMonth, userId, year]
    );
    return result.rows[0];
  }

  /**
   * Berie tento človek kvótu z PAM? Ľahká otázka bez getOrCreate.
   *
   * Používa sa na miestach, kde ide len o rozhodnutie „odpočítať / neodpočítať"
   * a bolo by zbytočné kvôli tomu zakladať riadok kvóty.
   */
  static async pamBacked(userId, year) {
    const { rows } = await pool.query(
      `SELECT u.personal_number,
              COALESCE(u.is_external, false) AS is_external,
              eq.pam_synced_at
         FROM users u
         LEFT JOIN employee_quotas eq ON eq.user_id = u.user_id AND eq.year = $2
        WHERE u.user_id = $1`,
      [userId, year]
    );
    return Quota.readsFromPam(rows[0]);
  }

  /**
   * Add used days (when ticket is approved)
   *
   * Pri človeku napojenom na PAM sa neodpočítava nič a vráti sa null. Kto
   * počíta, ten je pánom čísla: čerpanie vedie mzdová učtáreň v PAM a
   * appka by jej doň len vpisovala druhé, vlastné číslo. Presne to spôsobilo
   * rozdiel, kvôli ktorému sa celé napojenie robilo - appka odrátala
   * schválený sprievod, PAM o ňom ešte nevedel, a kolegyni nesedelo nič.
   *
   * Nenapojení (externí a tí, ktorým kolegyňa ešte nezadala osobné číslo)
   * fungujú ďalej presne ako doteraz.
   */
  static async addUsedDays(userId, year, type, days) {
    if (await this.pamBacked(userId, year)) return null;

    const columnMap = {
      'vacation': 'vacation_days_used',
      'sick-leave': 'sick_days_used',
      'paragraph': 'paragraph_days_used',
      'ocr': 'ocr_days_used'
    };
    const column = columnMap[type] || 'sick_days_used';
    const result = await pool.query(
      `UPDATE employee_quotas
       SET ${column} = ${column} + $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND year = $3
       RETURNING *`,
      [days, userId, year]
    );
    return result.rows[0];
  }

  /**
   * Remove used days (when ticket is rejected/cancelled after approval)
   *
   * Zrkadlovo k addUsedDays: komu sa neodpočítalo, tomu sa nemá čo vracať.
   * Bez tejto podmienky by zrušenie žiadosti pridalo človeku dni, ktoré mu
   * appka nikdy nevzala.
   */
  static async removeUsedDays(userId, year, type, days) {
    if (await this.pamBacked(userId, year)) return null;

    const columnMap = {
      'vacation': 'vacation_days_used',
      'sick-leave': 'sick_days_used',
      'paragraph': 'paragraph_days_used',
      'ocr': 'ocr_days_used'
    };
    const column = columnMap[type] || 'sick_days_used';
    const result = await pool.query(
      `UPDATE employee_quotas
       SET ${column} = GREATEST(${column} - $1, 0), updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND year = $3
       RETURNING *`,
      [days, userId, year]
    );
    return result.rows[0];
  }

  /**
   * Check if user has enough days
   *
   * Jediné miesto, kde sa od zostatku odpočítava aj to, čo je schválené a
   * PAM to ešte nespracoval. Zobrazuje sa číslo PAM, aby sa dalo porovnať s
   * PAM - ale povoliť ďalšiu žiadosť sa musí podľa toho, čo naozaj zostáva.
   * Inak by si človek vybral tie isté dni dvakrát: raz v septembri, a znovu
   * v októbri, kým PAM september nespracoval.
   */
  static async hasEnoughDays(userId, year, type, requestedDays) {
    const prefix = COLUMN_PREFIX[type];
    if (!prefix) return true; // Ostatné typy kvótu nemajú

    const quota = await this.effective(userId, year);
    if (!quota) return false;

    const remaining = quota[`${prefix}_days_remaining`] - (quota[`${prefix}_days_pending`] || 0);
    return remaining >= requestedDays;
  }

  // --- Quota Settings ---

  /**
   * Get quota settings for a year
   */
  static async getSettings(year) {
    const result = await pool.query(
      'SELECT * FROM quota_settings WHERE year = $1',
      [year]
    );
    return result.rows[0];
  }

  /**
   * Get all quota settings
   */
  static async getAllSettings() {
    const result = await pool.query(
      'SELECT * FROM quota_settings ORDER BY year DESC'
    );
    return result.rows;
  }

  /**
   * Upsert quota settings
   */
  static async upsertSettings(year, vacationDays, sickDays, carryOver = false, maxCarryOver = 0, paragraphDays = 7, ocrDays = 7) {
    const result = await pool.query(
      `INSERT INTO quota_settings (year, default_vacation_days, default_sick_days, carry_over_enabled, max_carry_over_days, default_paragraph_days, default_ocr_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (year) DO UPDATE SET
         default_vacation_days = EXCLUDED.default_vacation_days,
         default_sick_days = EXCLUDED.default_sick_days,
         carry_over_enabled = EXCLUDED.carry_over_enabled,
         max_carry_over_days = EXCLUDED.max_carry_over_days,
         default_paragraph_days = EXCLUDED.default_paragraph_days,
         default_ocr_days = EXCLUDED.default_ocr_days,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [year, vacationDays, sickDays, carryOver, maxCarryOver, paragraphDays, ocrDays]
    );
    return result.rows[0];
  }

  /**
   * Initialize quotas for all users for a given year
   * Uses quota_settings defaults, falls back to 20/5 if no settings exist
   */
  static async initializeForAllUsers(year) {
    const settings = await this.getSettings(year);
    const vacationDays = settings?.default_vacation_days || 20;
    const sickDays = settings?.default_sick_days || 5;

    const paragraphDays = settings?.default_paragraph_days || 7;
    const ocrDays = settings?.default_ocr_days || 7;

    const result = await pool.query(
      `INSERT INTO employee_quotas (user_id, year, vacation_days_total, sick_days_total, paragraph_days_total, ocr_days_total)
       SELECT u.user_id, $1, $2, $3, $4, $5
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM employee_quotas eq WHERE eq.user_id = u.user_id AND eq.year = $1
       )
       RETURNING *`,
      [year, vacationDays, sickDays, paragraphDays, ocrDays]
    );
    return result.rows;
  }
}

module.exports = Quota;
