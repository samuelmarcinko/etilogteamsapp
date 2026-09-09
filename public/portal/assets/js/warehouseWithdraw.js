/**
 * Vyskladnenie tovaru - tablet na stene v sklade.
 *
 * Obsluhuje to majster výroby na poobednej smene, v rukaviciach, v hluku a
 * poponáhľaní. Podľa toho je postavená celá obrazovka:
 *
 *   * Jeden krok, jedna otázka. Nič, čo sa práve nerozhoduje, na obrazovke nie je.
 *   * Krok, na ktorý existuje jediná odpoveď, sa preskočí - materiál na jednej
 *     pozícii sa nevyberá zo zoznamu s jednou položkou.
 *   * Mapa ukazuje, kam ísť, od chvíle, keď je to známe. Nie je to ozdoba,
 *     je to jediné, čo majstrovi povie, kde ten tovar leží.
 *   * Veľké terče. Palcom v rukavici sa netrafí do odkazu veľkosti textu.
 *
 * Po minúte nečinnosti sa rozrobený výdaj zahodí, po desiatich sa obrazovka
 * zamkne na PIN. Prvé je zdvorilosť voči ďalšiemu v poradí, druhé je zámok.
 */

const WD_IDLE_RESET_MS = 60 * 1000;
const WD_LOCK_MS = 10 * 60 * 1000;

let wdState = null;
let wdMapSvg = null;         // mapa sa sťahuje raz a drží sa
let wdIdleTimer = null;
let wdLockTimer = null;

/** Prázdny stav. Sem sa vracia každý dokončený aj zahodený výdaj. */
function wdBlank() {
    return {
        session: wdState?.session || null,
        unlockToken: wdState?.unlockToken || null,
        step: 'code',
        query: '',
        matches: [],
        material: null,
        placement: null,
        quantity: '',
        error: null,
        busy: false
    };
}

// ------------------------------------------------------------------ vstup

async function renderWarehouseWithdraw(container) {
    const res = await apiCall('/api/warehouse/withdrawals/session');
    if (!res.ok) {
        container.innerHTML = `<div class="page-body"><div class="empty-state">
            <div class="empty-icon">&#128274;</div>
            <div class="empty-text">Na vyskladnenie tovaru nemáte právo.</div>
        </div></div>`;
        return;
    }

    const session = (await res.json()).data;
    wdState = { ...wdBlank(), session };

    // Účet tabletu bez PINu je nefunkčný tablet, nie otvorené dvere. Povie sa
    // to nahlas a obrazovka sa neotvorí.
    if (session.kiosk && !session.hasPin) {
        container.innerHTML = `<div class="page-body"><div class="empty-state">
            <div class="empty-icon">&#128290;</div>
            <div class="empty-text">Tomuto tabletu ešte nikto nenastavil PIN.<br>
            Nastaví ho administrátor v Externých používateľoch.</div>
        </div></div>`;
        return;
    }

    // Celoobrazovkový režim len pre tablet. Skladníkovi za počítačom netreba
    // brať menu - on sa po portáli pohybuje ďalej.
    if (session.kiosk) document.body.classList.add('wd-active');

    if (!wdMapSvg) {
        wdMapSvg = await fetch('/portal/assets/images/warehouse-map.svg')
            .then(r => r.text()).catch(() => '');
    }

    wdState.step = session.kiosk ? 'locked' : 'code';
    wdRender();
}

/** Odchod z obrazovky. Bez tohto by tablet zostal v celoobrazovkovom režime. */
function wdLeave() {
    document.body.classList.remove('wd-active');
    clearTimeout(wdIdleTimer);
    clearTimeout(wdLockTimer);
    wdState = null;
}

// --------------------------------------------------------------- časovače

/**
 * Každý dotyk posúva oba časovače.
 *
 * Zamknúť obrazovku človeku pod rukami by bolo horšie než ju nezamknúť vôbec -
 * nabudúce by si našiel spôsob, ako to obísť.
 */
function wdTouch() {
    clearTimeout(wdIdleTimer);
    clearTimeout(wdLockTimer);
    if (!wdState || wdState.step === 'locked') return;

    wdIdleTimer = setTimeout(() => {
        // Na prvom kroku niet čo zahadzovať a blikanie obrazovky by len mýlilo.
        if (wdState && wdState.step !== 'code' && wdState.step !== 'locked') {
            wdState = { ...wdBlank() };
            wdRender();
        }
    }, WD_IDLE_RESET_MS);

    if (wdState.session?.kiosk) {
        wdLockTimer = setTimeout(() => {
            wdState = { ...wdBlank(), unlockToken: null, step: 'locked' };
            wdRender();
        }, WD_LOCK_MS);
    }
}

// ------------------------------------------------------------------ mapa

/**
 * Mapa s vyznačenými pozíciami.
 *
 * `highlight` sú všetky pozície, kde ten materiál leží; `chosen` je tá, ktorú
 * si majster vybral. Rozdiel je podstatný: kým nevyberie, blikajú všetky, a
 * potom svieti jedna.
 */
function wdMapHtml(highlight, chosen) {
    if (!wdMapSvg) return '';
    const key = (p) => `${p.zone}-${p.position}`;
    const lit = new Set(highlight.map(key));
    const one = chosen ? key(chosen) : null;

    const holder = document.createElement('div');
    holder.innerHTML = wdMapSvg;
    const svg = holder.querySelector('svg');
    const marks = [];

    holder.querySelectorAll('.pallet-loc').forEach(el => {
        const k = `${el.dataset.zone}-${el.dataset.num}`;
        const chosenHere = one && k === one;
        if (chosenHere) el.classList.add('wd-loc-chosen');
        else if (!one && lit.has(k)) el.classList.add('wd-loc-lit');
        else if (lit.has(k)) el.classList.add('wd-loc-lit-dim');
        else return;

        // Samotné paletové miesto je na mapke celého skladu veľké pár bodov -
        // z dvoch metrov od tabletu sa obrys nedá rozoznať. Značka nad ním má
        // vlastnú veľkosť, nezávislú od toho, aká drobná je tá bunka.
        const x = parseFloat(el.getAttribute('x'));
        const y = parseFloat(el.getAttribute('y'));
        const w = parseFloat(el.getAttribute('width'));
        const h = parseFloat(el.getAttribute('height'));
        if ([x, y, w, h].some(Number.isNaN)) return;

        marks.push({
            cx: x + w / 2,
            cy: y + h / 2,
            cls: chosenHere ? 'wd-mark-chosen' : (one ? 'wd-mark-dim' : 'wd-mark')
        });
    });

    if (svg && marks.length) {
        svg.insertAdjacentHTML('beforeend', marks.map(m =>
            `<circle class="${m.cls}" cx="${m.cx}" cy="${m.cy}" r="14"/>`).join(''));
    }

    return `<div class="wd-map">${holder.innerHTML}</div>`;
}

/** 1 pozícia, 2-4 pozície, 5 a viac pozícií. */
function wdPlural(n, one, few, many) {
    if (n === 1) return one;
    return n >= 2 && n <= 4 ? few : many;
}

// -------------------------------------------------------------- vykreslenie

function wdRender() {
    const el = document.getElementById('pageContent');
    if (!el || !wdState) return;

    const screens = {
        locked: wdLockScreen,
        code: wdCodeScreen,
        place: wdPlaceScreen,
        quantity: wdQuantityScreen,
        confirm: wdConfirmScreen,
        done: wdDoneScreen
    };
    el.innerHTML = `<div class="wd-shell">${screens[wdState.step]()}</div>`;

    if (wdState.step === 'code') setTimeout(() => document.getElementById('wdQuery')?.focus(), 60);
    wdTouch();
}

function wdHead(title, hint, back) {
    return `<header class="wd-head">
        ${back ? `<button class="wd-back" onclick="${back}">&#8592;</button>` : '<span></span>'}
        <div><h1>${title}</h1>${hint ? `<p>${hint}</p>` : ''}</div>
        <button class="wd-cancel" onclick="wdReset()">Zrušiť</button>
    </header>`;
}

function wdErrorBox() {
    return wdState.error ? `<div class="wd-error">${escapeHtml(wdState.error)}</div>` : '';
}

// ------------------------------------------------------------------- PIN

function wdLockScreen() {
    const dots = Array.from({ length: wdState.session.pinLength || 4 }, (_, i) =>
        `<i class="${(wdState.query || '').length > i ? 'on' : ''}"></i>`).join('');

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
        .map(k => k === ''
            ? '<span></span>'
            : `<button class="wd-key" onclick="wdPin('${k === '⌫' ? 'del' : k}')">${k}</button>`)
        .join('');

    return `<div class="wd-lock">
        <img src="/assets/images/logo.png" alt="ETILOG" class="wd-lock-logo">
        <h1>Vyskladnenie tovaru</h1>
        <p>Zadajte PIN</p>
        <div class="wd-dots">${dots}</div>
        ${wdErrorBox()}
        <div class="wd-pad">${keys}</div>
    </div>`;
}

async function wdPin(key) {
    wdTouch();
    const len = wdState.session.pinLength || 4;

    if (key === 'del') {
        wdState.query = (wdState.query || '').slice(0, -1);
        wdState.error = null;
        return wdRender();
    }

    wdState.query = ((wdState.query || '') + key).slice(0, len);
    wdState.error = null;
    wdRender();

    if (wdState.query.length < len) return;

    try {
        const res = await apiCall('/api/warehouse/withdrawals/unlock', {
            method: 'POST', body: JSON.stringify({ pin: wdState.query })
        });
        const body = await res.json();

        if (!res.ok) {
            wdState.query = '';
            wdState.error = body.error === 'locked'
                ? 'Priveľa pokusov. Skúste o minútu.'
                : (body.left === 1 ? 'Nesprávny PIN. Ostáva posledný pokus.'
                  : body.left != null ? `Nesprávny PIN. Ostávajú ${body.left} pokusy.`
                  : 'Nesprávny PIN.');
            return wdRender();
        }

        wdState = { ...wdBlank(), session: wdState.session, unlockToken: body.data.unlockToken };
        wdRender();
    } catch (e) {
        wdState.query = '';
        wdState.error = 'Server neodpovedal.';
        wdRender();
    }
}

// -------------------------------------------------------- 1. číslo materiálu

function wdCodeScreen() {
    const list = wdState.matches.map(m => `
        <button class="wd-hit" onclick="wdPick(${m.id})">
            <span class="wd-hit-main">
                <strong>${escapeHtml(m.name)}</strong>
                <small>${m.code ? escapeHtml(m.code) : 'vlastná položka'}${m.project_fg ? ` · ${escapeHtml(m.project_fg)}` : ''}</small>
            </span>
            <span class="wd-hit-side">${m.placements.length} ${wdPlural(m.placements.length, 'pozícia', 'pozície', 'pozícií')}</span>
        </button>`).join('');

    return `${wdHead('Vyskladnenie tovaru', 'Zadajte číslo materiálu')}
        <div class="wd-body wd-body-narrow">
            <input class="wd-input" id="wdQuery" autocomplete="off" inputmode="text"
                   placeholder="napr. RM102750" value="${escapeHtml(wdState.query)}"
                   oninput="wdSearch(this.value)">
            ${wdErrorBox()}
            <div class="wd-hits">${list}</div>
            ${!wdState.query ? `<p class="wd-tip">Vyskladniť sa dá len materiál, ktorý je v Evidencii.
                Vlastné položky sa hľadajú názvom — napríklad <em>tašky</em>.</p>` : ''}
        </div>`;
}

let wdSearchTimer = null;
function wdSearch(value) {
    wdTouch();
    wdState.query = value;
    wdState.error = null;
    clearTimeout(wdSearchTimer);

    if (value.trim().length < 2) { wdState.matches = []; return wdRender(); }

    wdSearchTimer = setTimeout(async () => {
        try {
            const res = await apiCall(`/api/warehouse/withdrawals/search?q=${encodeURIComponent(value.trim())}`);
            const found = res.ok ? ((await res.json()).data || []) : [];
            if (wdState.query !== value) return;   // medzitým doťukal ďalšie písmeno

            wdState.matches = found;
            wdState.error = found.length ? null : 'Taký materiál v Evidencii nie je.';
            wdRender();
            document.getElementById('wdQuery')?.focus();
        } catch (e) {
            wdState.error = 'Server neodpovedal.';
            wdRender();
        }
    }, 300);
}

function wdPick(materialId) {
    wdTouch();
    const material = wdState.matches.find(m => m.id === materialId);
    if (!material) return;

    wdState.material = material;
    wdState.error = null;

    // Jedna pozícia: nie je z čoho vyberať, tak sa nepýtame.
    if (material.placements.length === 1) {
        wdState.placement = material.placements[0];
        wdState.step = 'quantity';
    } else {
        wdState.step = 'place';
    }
    wdRender();
}

// -------------------------------------------------------------- 2. pozícia

function wdPlaceScreen() {
    const m = wdState.material;
    const buttons = m.placements.map(p => `
        <button class="wd-place" onclick="wdPickPlace('${escapeHtml(p.location_code)}')">
            <strong>${escapeHtml(p.location_code)}</strong>
            <span>${p.quantity} ${escapeHtml(m.unit || 'ks')}</span>
        </button>`).join('');

    return `${wdHead(escapeHtml(m.name), 'Z ktorej pozície beriete?', "wdBack('code')")}
        <div class="wd-body wd-split">
            <div class="wd-col-map">${wdMapHtml(m.placements, null)}</div>
            <div class="wd-col-side">
                <div class="wd-places">${buttons}</div>
            </div>
        </div>`;
}

function wdPickPlace(code) {
    wdTouch();
    wdState.placement = wdState.material.placements.find(p => p.location_code === code);
    wdState.step = 'quantity';
    wdRender();
}

// --------------------------------------------------------------- 3. počet

function wdQuantityScreen() {
    const m = wdState.material;
    const p = wdState.placement;
    const local = m.kind === 'local';

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']
        .map(k => `<button class="wd-key" onclick="wdQty('${k === '⌫' ? 'del' : k}')">${k}</button>`)
        .join('');

    return `${wdHead(escapeHtml(m.name), `Pozícia ${escapeHtml(p.location_code)} · koľko kusov beriete?`,
                     m.placements.length > 1 ? "wdBack('place')" : "wdBack('code')")}
        <div class="wd-body wd-split">
            <div class="wd-col-map">${wdMapHtml(m.placements, p)}</div>
            <div class="wd-col-side">
                <div class="wd-qty">${wdState.quantity || '0'}<small>${escapeHtml(m.unit || 'ks')}</small></div>
                ${wdState.error ? '' : (local
                    ? `<p class="wd-note">Vlastná položka — zapísaný počet <strong>${p.quantity}</strong> je len
                       poznámka skladníka, nie stav skladu. Zoberte, koľko naozaj beriete.</p>`
                    : `<p class="wd-note">Na pozícii je <strong>${p.quantity} ${escapeHtml(m.unit || 'ks')}</strong>.</p>`)}
                ${wdErrorBox()}
                <div class="wd-pad wd-pad-wide">${keys}</div>
                <div class="wd-qty-actions">
                    ${local ? '' : `<button class="wd-secondary" onclick="wdQtyAll()">Všetko (${p.quantity})</button>`}
                    <button class="wd-primary" onclick="wdToConfirm()"
                            ${Number(wdState.quantity) > 0 ? '' : 'disabled'}>Pokračovať</button>
                </div>
            </div>
        </div>`;
}

function wdQty(key) {
    wdTouch();
    wdState.error = null;
    if (key === 'del') wdState.quantity = wdState.quantity.slice(0, -1);
    else if (key === 'C') wdState.quantity = '';
    // Šesť číslic je viac, než sa zmestí na paletu; dlhšie číslo je preklep.
    else if (wdState.quantity.length < 6) wdState.quantity = (wdState.quantity + key).replace(/^0+/, '');
    wdRender();
}

function wdQtyAll() {
    wdTouch();
    wdState.quantity = String(wdState.placement.quantity);
    wdRender();
}

function wdToConfirm() {
    wdTouch();
    const qty = Number(wdState.quantity);
    if (!(qty > 0)) return;

    // Vlastné položky sa nekontrolujú - ich počet je poznámka, nie stav.
    if (wdState.material.kind !== 'local' && qty > wdState.placement.quantity) {
        wdState.error = `Na pozícii je len ${wdState.placement.quantity} ${wdState.material.unit || 'ks'}.`;
        return wdRender();
    }
    wdState.step = 'confirm';
    wdRender();
}

// -------------------------------------------------------------- 4. súhrn

function wdConfirmScreen() {
    const m = wdState.material;
    const p = wdState.placement;
    const qty = Number(wdState.quantity);
    const local = m.kind === 'local';

    return `${wdHead('Skontrolujte a potvrďte', null, "wdBack('quantity')")}
        <div class="wd-body wd-split">
            <div class="wd-col-map">${wdMapHtml(m.placements, p)}</div>
            <div class="wd-col-side">
                <dl class="wd-summary">
                    <div><dt>Materiál</dt><dd>${escapeHtml(m.name)}</dd></div>
                    <div><dt>Kód</dt><dd>${m.code ? escapeHtml(m.code) : '<span class="wd-dim">vlastná položka</span>'}</dd></div>
                    <div><dt>Pozícia</dt><dd class="wd-strong">${escapeHtml(p.location_code)}</dd></div>
                    <div><dt>Vyskladňujete</dt><dd class="wd-strong">${qty} ${escapeHtml(m.unit || 'ks')}</dd></div>
                    <div><dt>Zostane</dt><dd>${local
                        ? '<span class="wd-dim">počet sa nemení — vlastná položka</span>'
                        : `${p.quantity - qty} ${escapeHtml(m.unit || 'ks')}`}</dd></div>
                </dl>
                ${wdErrorBox()}
                <button class="wd-primary wd-big" onclick="wdSubmit()" ${wdState.busy ? 'disabled' : ''}>
                    ${wdState.busy ? 'Zapisujem…' : 'Vyskladniť'}
                </button>
            </div>
        </div>`;
}

async function wdSubmit() {
    if (wdState.busy) return;
    wdTouch();
    wdState.busy = true;
    wdState.error = null;
    wdRender();

    try {
        const res = await apiCall('/api/warehouse/withdrawals', {
            method: 'POST',
            headers: wdState.unlockToken ? { 'X-Unlock-Token': wdState.unlockToken } : {},
            body: JSON.stringify({
                materialId: wdState.material.id,
                locationId: wdState.placement.location_id,
                quantity: Number(wdState.quantity)
            })
        });
        const body = await res.json();

        if (!res.ok) {
            wdState.busy = false;
            // Vypršaný zámok nie je chyba, na ktorú sa dá odpovedať - treba PIN.
            if (res.status === 423) {
                wdState = { ...wdBlank(), session: wdState.session, unlockToken: null, step: 'locked' };
                return wdRender();
            }
            wdState.error = body.message || 'Vyskladnenie sa nepodarilo zapísať.';
            return wdRender();
        }

        wdState.step = 'done';
        wdState.busy = false;
        wdRender();
        // Krátko, nech to majster stihne prečítať, a späť na začiatok - ďalší
        // človek nemá začínať v cudzom hotovom výdaji.
        setTimeout(() => { if (wdState?.step === 'done') wdReset(); }, 4000);
    } catch (e) {
        wdState.busy = false;
        wdState.error = 'Server neodpovedal. Skúste to znova.';
        wdRender();
    }
}

function wdDoneScreen() {
    const m = wdState.material;
    return `<div class="wd-done">
        <div class="wd-done-mark">&#10003;</div>
        <h1>Vyskladnené</h1>
        <p>${escapeHtml(m.name)} · ${wdState.quantity} ${escapeHtml(m.unit || 'ks')}
           z pozície ${escapeHtml(wdState.placement.location_code)}</p>
        <button class="wd-primary" onclick="wdReset()">Ďalší výdaj</button>
    </div>`;
}

// ------------------------------------------------------------------ návrat

function wdBack(step) {
    wdTouch();
    wdState.error = null;
    if (step === 'code') { wdState.material = null; wdState.placement = null; wdState.quantity = ''; }
    if (step === 'place') { wdState.placement = null; wdState.quantity = ''; }
    wdState.step = step;
    wdRender();
}

function wdReset() {
    const keep = { session: wdState?.session, unlockToken: wdState?.unlockToken };
    wdState = { ...wdBlank(), ...keep };
    wdRender();
}

/* ============================================================
   VYSKLADNENIA - stránka pre skladníkov
   ============================================================

   Kompletná história, od najnovšieho. Nič sa odtiaľto nemaže: stornovaný výdaj
   zostáva prečiarknutý aj s dôvodom, lebo "koľko tam bolo minulý týždeň" je
   otázka, na ktorú sa raz niekto spýta.

   Čo treba vybaviť v SAPe, nehovorí táto stránka - to hovorí oranžový semafor
   pri materiáli. Tu je záznam, tam je práca. */

let whWithdrawals = [];

async function renderWarehouseWithdrawals(container) {
    container.innerHTML = `
        <div class="page-header">
            <div>
                <h1>Vyskladnenia</h1>
                <p>Čo si majstri odobrali zo skladu. Do SAPu sa tieto výdaje zapisujú ručne.</p>
            </div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-header wh-map-head">
                    <div class="wd-filters">
                        <input type="text" id="wdSearchInput" class="form-control wh-search-input"
                               placeholder="Materiál, kód alebo pozícia…" autocomplete="off">
                        <select id="wdStatusFilter" class="form-control">
                            <option value="">Všetky</option>
                            <option value="active">Platné</option>
                            <option value="voided">Stornované</option>
                        </select>
                        <input type="date" id="wdFrom" class="form-control" title="Od">
                        <input type="date" id="wdTo" class="form-control" title="Do">
                    </div>
                </div>
                <div class="card-body" id="wdListBody" style="overflow-x:auto">
                    <div class="empty-state"><div class="spinner"></div></div>
                </div>
            </div>
        </div>`;

    ['wdSearchInput', 'wdStatusFilter', 'wdFrom', 'wdTo'].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener(id === 'wdSearchInput' ? 'input' : 'change', wdLoadListDebounced);
    });

    await wdLoadList();
    // Zoznam je otvorený, takže lišta o "novom od poslednej návštevy" splnila
    // svoje - ďalej by už len opakovala, čo má človek pred sebou.
    await wdMarkSeen();
}

let wdListTimer = null;
function wdLoadListDebounced() {
    clearTimeout(wdListTimer);
    wdListTimer = setTimeout(wdLoadList, 250);
}

async function wdLoadList() {
    const body = document.getElementById('wdListBody');
    if (!body) return;

    const params = new URLSearchParams();
    const add = (key, id) => { const v = document.getElementById(id)?.value; if (v) params.set(key, v); };
    add('search', 'wdSearchInput');
    add('status', 'wdStatusFilter');
    add('from', 'wdFrom');
    add('to', 'wdTo');

    try {
        const res = await apiCall(`/api/warehouse/withdrawals?${params}`);
        whWithdrawals = res.ok ? ((await res.json()).data || []) : [];
    } catch (e) {
        body.innerHTML = `<div class="empty-state"><div class="empty-text">Nepodarilo sa načítať.</div></div>`;
        return;
    }

    if (!whWithdrawals.length) {
        body.innerHTML = `<div class="empty-state">
            <div class="empty-icon">&#128722;</div>
            <div class="empty-text">Žiadne vyskladnenia.</div>
        </div>`;
        return;
    }

    const canEdit = canEditWarehouse();
    body.innerHTML = `
        <table class="data-table">
            <thead><tr>
                <th>Kedy</th><th>Materiál</th><th>Pozícia</th><th style="text-align:right">Počet</th>
                <th>Stav</th>${canEdit ? '<th></th>' : ''}
            </tr></thead>
            <tbody>${whWithdrawals.map(w => wdRow(w, canEdit)).join('')}</tbody>
        </table>`;
}

function wdRow(w, canEdit) {
    const off = w.status === 'voided';
    return `<tr${off ? ' class="wd-row-void"' : ''}>
        <td class="wh-date-cell">${whFormatDate(w.created_at)}</td>
        <td>
            <strong>${escapeHtml(w.material_name)}</strong>
            ${w.material_code ? `<small class="wh-muted"> · ${escapeHtml(w.material_code)}</small>` : ''}
            ${w.quantity_touched ? '' : '<small class="wh-muted"> · vlastná položka, počet sa nemenil</small>'}
        </td>
        <td><span class="wd-loc-chip">${escapeHtml(w.location_code)}</span></td>
        <td style="text-align:right"><strong>${w.quantity}</strong></td>
        <td>${off
            ? `<span class="badge badge-hidden" title="${escapeHtml(w.voided_reason || '')}">stornované</span>`
            : '<span class="badge badge-visible">platné</span>'}</td>
        ${canEdit ? `<td>${off ? '' :
            `<button class="btn-icon" onclick="wdVoid(${w.id})" title="Stornovať a vrátiť počet">&#8630;</button>`}</td>` : ''}
    </tr>`;
}

/**
 * Storno.
 *
 * Vracia počet na pôvodnú pozíciu, takže je to zásah do skladu - pýtame sa
 * naň a chceme k nemu dôvod. Ten dôvod si o mesiac prečíta ten, kto sa bude
 * čudovať, prečo počet nesedí s papierom.
 */
async function wdVoid(id) {
    const w = whWithdrawals.find(x => x.id === id);
    if (!w) return;

    const reason = prompt(
        `Stornovať vyskladnenie?\n\n${w.material_name} · ${w.quantity} ks z ${w.location_code}\n` +
        (w.quantity_touched ? 'Počet sa vráti na pôvodnú pozíciu.\n' : 'Počet sa nemenil, takže sa ani nevracia.\n') +
        '\nDôvod:'
    );
    if (reason === null) return;

    try {
        const res = await apiCall(`/api/warehouse/withdrawals/${id}/void`, {
            method: 'POST', body: JSON.stringify({ reason: reason.trim() || null })
        });
        const body = await res.json();
        if (!res.ok) { showToast(body.message || 'Storno sa nepodarilo', 'error'); return; }
        showToast('Stornované', 'success');
        wdLoadList();
    } catch (e) { showToast('Storno sa nepodarilo', 'error'); }
}

/* ------------------------------------------------------------------ lišta */

/**
 * "Toto pribudlo, odkedy si tu bol naposledy."
 *
 * Oznam, nie zoznam práce - preto sa dá zavrieť a preto sa neopakuje donekonečna.
 * Čo treba vybaviť v SAPe, svieti oranžovou pri materiáli.
 */
async function wdCheckNew() {
    if (!hasModuleAccess('warehouse')) return;

    let list = [];
    try {
        const res = await apiCall('/api/warehouse/withdrawals/new');
        if (!res.ok) return;
        list = (await res.json()).data || [];
    } catch (e) { return; }

    const badge = document.getElementById('whWithdrawCount');
    if (badge) {
        badge.textContent = list.length;
        badge.hidden = list.length === 0;
    }
    if (!list.length) return;

    const top = list.slice(0, 3).map(w =>
        `${escapeHtml(w.material_name)} · ${w.quantity} ks · ${escapeHtml(w.location_code)}`).join('<br>');

    const bar = document.createElement('div');
    bar.className = 'wd-bar';
    bar.innerHTML = `
        <div class="wd-bar-icon">&#128722;</div>
        <div class="wd-bar-text">
            <strong>${list.length === 1 ? 'Nové vyskladnenie' : `Nové vyskladnenia (${list.length})`}</strong>
            <div>${top}${list.length > 3
                ? `<br><span class="wh-muted">${wdPlural(list.length - 3,
                    'a ešte jedno', `a ešte ${list.length - 3} ďalšie`, `a ešte ${list.length - 3} ďalších`)}</span>`
                : ''}</div>
            <small>Nezabudnite ich zapísať do SAPu — appka to za vás neurobí.</small>
        </div>
        <div class="wd-bar-actions">
            <button class="btn btn-primary" onclick="wdOpenList()">Zobraziť</button>
            <button class="btn btn-secondary" onclick="wdDismissBar()">Zavrieť</button>
        </div>`;
    document.body.appendChild(bar);
}

function wdOpenList() {
    wdDismissBar();
    navigateToPage('warehouse-withdrawals');
}

async function wdDismissBar() {
    document.querySelector('.wd-bar')?.remove();
    const badge = document.getElementById('whWithdrawCount');
    if (badge) badge.hidden = true;
    await wdMarkSeen();
}

async function wdMarkSeen() {
    try { await apiCall('/api/warehouse/withdrawals/seen', { method: 'POST' }); } catch (e) {}
}
