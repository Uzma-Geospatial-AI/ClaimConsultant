/* =======================================================================
   auth.js — the BDOS sign-in gate

   Only three people use this app, so the door is a BDOS account
   (https://bdos.uzmadigitalearth.app) plus the allow-list below.

   BDOS issues a stateless JWT that lasts 30 days. We keep it in
   localStorage and send it back as `Authorization: Bearer <token>`.
   There is no server-side logout, so signing out simply discards it.

   What this gate is NOT: a security boundary. Everything it hides is HTML
   and JavaScript the browser has already downloaded, and anyone can open
   the folder directly. Read it as "who is at the keyboard, and are they
   meant to be here" — not as a lock on the documents. The lock is the same
   list on the BDOS side, which decides who the stored work is handed to;
   this one only decides what the sign-in page says.
   ======================================================================= */

const BDOS_BASE = 'https://bdos.uzmadigitalearth.app';

/** The only accounts allowed in. Compared lower-case and trimmed. */
const ALLOWED_USERS = [
  'adlishah0821@gmail.com',
  'nuramilazulfa@gmail.com',
  'hanis.rashidan@uzmagroup.com'
];

const TOKEN_KEY = 'ccs.token';
const USER_KEY  = 'ccs.user';

const normEmail = e => String(e || '').trim().toLowerCase();
const isAllowed = e => ALLOWED_USERS.includes(normEmail(e));

/* -----------------------------------------------------------------------
   Token helpers. We read `exp` only to know whether the token is worth
   trying — never to decide what somebody may do. BDOS re-verifies the
   signature on every protected call, and that is the answer that counts.
   ----------------------------------------------------------------------- */
function decodeJwt (token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
    const json = decodeURIComponent(
      raw.split('')
         .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
         .join('')
    );
    return JSON.parse(json);
  } catch (err) { return null; }
}

function tokenExpired (token) {
  const claims = decodeJwt(token);
  if (!claims || !claims.exp) return true;
  return claims.exp * 1000 <= Date.now();
}

/* ---------------- the stored session ---------------- */
function storedToken () {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}

function storedUser () {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch (e) { return null; }
}

function saveSession (token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) { /* private window or full quota — the session just won't outlive the tab */ }
}

function clearSession () {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {}
}

/* -----------------------------------------------------------------------
   Talking to BDOS
   ----------------------------------------------------------------------- */
async function bdosError (res, fallback) {
  try {
    const body = await res.json();
    return new Error(body.detail || fallback);
  } catch (e) { return new Error(fallback); }
}

async function bdosLogin (email, password) {
  const typed = String(email || '').trim();
  if (!typed || !password) throw new Error('Enter your email and password.');
  if (!isAllowed(typed)) throw new Error('That account is not on the list for this app.');

  let res;
  try {
    res = await fetch(BDOS_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: typed, password: password })
    });
  } catch (err) {
    throw new Error('Cannot reach BDOS. Check your internet connection and try again.');
  }

  if (res.status === 401) {
    console.info('BDOS refused the sign-in for ' + typed +
                 '. It answers 401 both for a wrong password and for an address it has ' +
                 'never heard of, so check with a BDOS admin that this account exists.');
    throw new Error('BDOS did not accept that email and password.');
  }
  if (!res.ok) throw await bdosError(res, 'Sign-in failed. Please try again.');

  const data = await res.json();
  if (!data || !data.token || !data.user) throw new Error('BDOS returned an unexpected response.');

  // The address BDOS confirms is the one that decides — not the one typed in.
  if (!isAllowed(data.user.email)) throw new Error('That account is not on the list for this app.');

  saveSession(data.token, data.user);
  return data.user;
}

/** Ask BDOS who the stored token belongs to. Throws when the session is over. */
async function bdosMe () {
  const token = storedToken();
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(BDOS_BASE + '/auth/me', {
    headers: { Authorization: 'Bearer ' + token }
  });

  if (res.status === 401) {
    clearSession();
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) throw await bdosError(res, 'Could not verify the session.');

  const data = await res.json();
  const user = data && data.user;
  if (!user || !isAllowed(user.email)) {
    clearSession();
    throw new Error('That account is not on the list for this app.');
  }

  saveSession(token, user);
  return user;
}

/* =======================================================================
   The gate
   ======================================================================= */

/** Re-check a restored session with BDOS — but never punish being offline. */
function revalidateSession () {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  bdosMe()
    .then(paintWho)
    .catch(() => {
      // Only a definite rejection closes the door: bdosMe() clears the
      // session on 401. A dead network leaves the token in place, because
      // it is good for 30 days and the app itself needs no server.
      if (!storedToken()) {
        alert('Your BDOS session has ended. Please sign in again.');
        location.reload();
      }
    });
}

function paintWho (user) {
  if (!user) return;
  const who = document.getElementById('authWho');
  if (who) {
    who.textContent = user.name || user.email;
    who.title = user.email;
    who.hidden = false;
  }
  const out = document.getElementById('btnSignOut');
  if (out) out.hidden = false;
}

let started = false;

function unlockApp (user, onUnlock) {
  const gate = document.getElementById('authGate');
  if (gate) gate.hidden = true;
  document.body.classList.remove('locked');
  paintWho(user);

  // Once only. A second run would bind every button's handler a second time,
  // and the app would answer each click twice.
  if (started) return;
  started = true;
  onUnlock();
}

function showGate (onUnlock) {
  const gate  = document.getElementById('authGate');
  const form  = document.getElementById('authForm');
  const email = document.getElementById('authEmail');
  const pass  = document.getElementById('authPassword');
  const btn   = document.getElementById('authSubmit');
  const err   = document.getElementById('authError');
  if (!gate || !form) return;

  gate.hidden = false;
  document.body.classList.add('locked');
  setTimeout(() => email.focus(), 50);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const user = await bdosLogin(email.value, pass.value);
      pass.value = '';
      unlockApp(user, onUnlock);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      pass.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function signOut () {
  clearSession();
  location.reload();
}

/**
 * Run the gate, then hand the app over.
 *
 * A token already in hand unlocks straight away, so the app still opens
 * on a plane or behind a blocked network — half its point is that it needs
 * no server. BDOS confirms the token in the background when online.
 */
function startAuth (onUnlock) {
  const token = storedToken();
  const user  = storedUser();

  if (token && user && isAllowed(user.email) && !tokenExpired(token)) {
    unlockApp(user, onUnlock);
    revalidateSession();
  } else {
    if (token) clearSession();          // expired, or no longer on the list
    showGate(onUnlock);
  }

  const out = document.getElementById('btnSignOut');
  if (out) out.addEventListener('click', signOut);
}

const Auth = {
  start: startAuth,
  signOut: signOut,
  user: storedUser,
  token: storedToken,
  isAllowed: isAllowed,
  BASE: BDOS_BASE
};
