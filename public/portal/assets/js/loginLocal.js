/**
 * Prihlásenie e-mailom a heslom.
 *
 * Beží vedľa MSAL-u, nie namiesto neho: firemní ľudia idú cez Microsoft, tí
 * zvonku heslom. Formulár sa zobrazí len vtedy, keď je heslom prihlásenie na
 * serveri naozaj zapnuté - inak by tam stálo pole, do ktorého sa nedá prihlásiť.
 */

/** Chyby zo servera na hlášky, ktoré niečo hovoria. */
const AUTH_ERROR_KEYS = {
  bad_credentials: 'loginErrBadCredentials',
  locked: 'loginErrLocked',
  disabled: 'loginErrDisabled',
  not_configured: 'loginErrNotConfigured',
  too_short: 'loginErrTooShort',
  mismatch: 'loginErrMismatch',
  network: 'loginErrNetwork'
};

let authPendingToken = null;   // token držaný, kým si človek nezmení heslo
let authHasPassword = false;   // ponúka server prihlásenie heslom?

/* ------------------------------------------------------------------ jazyk */

/**
 * Prihlasovacia stránka začína v angličtine.
 *
 * Chodia sem aj ľudia zvonku, ktorí po slovensky nevedia - a rozdiel oproti
 * portálu je zámerný: kto si jazyk raz zvolí, ten sa uloží a portál ho preberie.
 * Kým si nezvolí nič, portál zostáva po slovensky, lebo ho používajú naši ľudia.
 * Prepnúť predvolený jazyk celého portálu je iné rozhodnutie než toto.
 */
function authInitLang() {
  if (!localStorage.getItem('etilog_portal_lang')) portalLang = 'en';
  authApplyLang();
}

function authSetLang(lang) {
  portalLang = lang;
  localStorage.setItem('etilog_portal_lang', lang);
  authApplyLang();
}

/**
 * Preloží stránku na mieste.
 *
 * Cez `data-i18n` atribúty, nie prestavaním HTML: rozpísané heslo a e-mail
 * musia prepnutie jazyka prežiť. Nikto nechce písať prihlasovacie údaje
 * druhýkrát preto, že si to prepol do slovenčiny.
 */
function authApplyLang() {
  document.documentElement.lang = portalLang;
  document.title = 'ETILOG Portal – ' + pt('loginTitle');

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = pt(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = pt(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-label]').forEach((el) => {
    el.setAttribute('aria-label', pt(el.dataset.i18nLabel));
  });

  // Úvodná veta závisí od toho, či je heslom prihlásenie vôbec zapnuté.
  document.getElementById('authLead').textContent =
    pt(authHasPassword ? 'loginLeadBoth' : 'loginLeadMs');

  document.querySelectorAll('.auth-lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === portalLang);
  });

  // Chybová hláška na obrazovke sa musí preložiť tiež - inak by po prepnutí
  // zostala visieť v jazyku, ktorý už nikto nečíta.
  const box = document.getElementById('authError');
  if (!box.hidden && box.dataset.errorKey) authShowError(box.dataset.errorKey);
}

function authShowError(key) {
  const box = document.getElementById('authError');
  box.dataset.errorKey = key;
  box.textContent = pt(AUTH_ERROR_KEYS[key] || AUTH_ERROR_KEYS.bad_credentials);
  box.hidden = false;
}

function authClearError() {
  const box = document.getElementById('authError');
  box.hidden = true;
  delete box.dataset.errorKey;
}

function authBusy(on) {
  document.getElementById('authBusy').hidden = !on;
  document.getElementById('authSubmit').disabled = on;
}

function authTogglePassword() {
  const input = document.getElementById('authPass');
  const shown = input.type === 'text';
  input.type = shown ? 'password' : 'text';
  document.getElementById('authEye').setAttribute(
    'aria-label', pt(shown ? 'loginShowPassword' : 'loginHidePassword')
  );
}

/**
 * Čo stránka smie ponúknuť.
 *
 * Rozhoduje o tom server: bez nastaveného tajomstva sa heslom prihlásiť nedá a
 * formulár by bol len sľub, ktorý sa nedá splniť.
 */
async function authLoadMethods() {
  try {
    const res = await fetch('/api/auth/methods');
    const { data } = await res.json();
    if (data?.password) {
      authHasPassword = true;
      document.getElementById('authPasswordBlock').hidden = false;
      document.getElementById('authLead').textContent = pt('loginLeadBoth');
    }
  } catch (e) {
    // Nedostupný server neznamená schovať Microsoft - ten funguje bez nás.
  }
}

async function authSignIn(event) {
  event.preventDefault();
  authClearError();
  authBusy(true);

  let body;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('authEmail').value.trim(),
        password: document.getElementById('authPass').value
      })
    });
    body = await res.json();
    if (!res.ok) { authBusy(false); authShowError(body.error); return; }
  } catch (e) {
    authBusy(false);
    authShowError('network');
    return;
  }

  // Heslo nastavené správcom platí na jedno prihlásenie. Token si podržíme,
  // ale do portálu sa človek dostane až so svojím vlastným heslom.
  if (body.data.mustChangePassword) {
    authPendingToken = body.data.token;
    authBusy(false);
    document.getElementById('authPasswordBlock').hidden = true;
    document.getElementById('msBtn').hidden = true;
    // Úvodná veta ponúka dve cesty dnu; v tomto kroku už žiadna z nich neplatí,
    // vysvetlenie nesie poznámka nad formulárom.
    document.getElementById('authLead').hidden = true;
    document.getElementById('authChangeBlock').hidden = false;
    document.getElementById('authNewPass').focus();
    return;
  }

  authEnterPortal(body.data.token);
}

function authEnterPortal(token) {
  localStorage.setItem('etilog_token', token);
  // Značka, aby sa zvyšok appky nepokúšal obnovovať reláciu u Microsoftu, ktorú
  // tento človek nikdy nemal.
  localStorage.setItem('etilog_auth', 'local');
  window.location.href = '/portal/';
}

async function authChangePassword(event) {
  event.preventDefault();
  authClearError();

  const first = document.getElementById('authNewPass').value;
  const again = document.getElementById('authNewPass2').value;

  if (first !== again) { authShowError('mismatch'); return; }
  if (first.length < 10) { authShowError('too_short'); return; }

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authPendingToken}`
      },
      body: JSON.stringify({
        currentPassword: document.getElementById('authPass').value,
        newPassword: first
      })
    });
    const body = await res.json();
    if (!res.ok) { authShowError(body.error); return; }
  } catch (e) {
    authShowError('network');
    return;
  }

  authEnterPortal(authPendingToken);
}

document.addEventListener('DOMContentLoaded', () => {
  authInitLang();
  authLoadMethods();
  document.getElementById('authForm')?.addEventListener('submit', authSignIn);
  document.getElementById('authChangeForm')?.addEventListener('submit', authChangePassword);
});
