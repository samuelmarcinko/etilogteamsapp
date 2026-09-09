/**
 * Prihlásenie e-mailom a heslom.
 *
 * Beží vedľa MSAL-u, nie namiesto neho: firemní ľudia idú cez Microsoft, tí
 * zvonku heslom. Formulár sa zobrazí len vtedy, keď je heslom prihlásenie na
 * serveri naozaj zapnuté - inak by tam stálo pole, do ktorého sa nedá prihlásiť.
 */

const AUTH_MESSAGES = {
  bad_credentials: 'Nesprávny e-mail alebo heslo.',
  locked: 'Účet je po viacerých neúspešných pokusoch dočasne zamknutý. Skúste o 15 minút.',
  disabled: 'Tento účet je vypnutý. Ozvite sa správcovi.',
  not_configured: 'Prihlásenie heslom nie je na tomto portáli zapnuté.',
  too_short: 'Heslo musí mať aspoň 10 znakov.',
  mismatch: 'Heslá sa nezhodujú.',
  network: 'Server neodpovedal. Skúste to znova.'
};

let authPendingToken = null;   // token držaný, kým si človek nezmení heslo

function authShowError(key) {
  const box = document.getElementById('authError');
  box.textContent = AUTH_MESSAGES[key] || AUTH_MESSAGES.bad_credentials;
  box.hidden = false;
}

function authClearError() {
  document.getElementById('authError').hidden = true;
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
    'aria-label', shown ? 'Zobraziť heslo' : 'Skryť heslo'
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
      document.getElementById('authPasswordBlock').hidden = false;
      document.getElementById('authLead').textContent =
        'Pokračujte pracovným účtom Microsoft, alebo sa prihláste heslom.';
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
  authLoadMethods();
  document.getElementById('authForm')?.addEventListener('submit', authSignIn);
  document.getElementById('authChangeForm')?.addEventListener('submit', authChangePassword);
});
