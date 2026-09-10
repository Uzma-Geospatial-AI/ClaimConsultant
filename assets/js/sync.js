/* =======================================================================
   sync.js — keeping profiles, the current draft and the claims history
             in the `cradle` database, through BDOS.

   The browser cannot talk to PostgreSQL, and a static app has nowhere safe
   to keep a database password. So BDOS holds the database and exposes it
   over the same authenticated API the sign-in already uses; this file is
   the client half. The endpoints are specified in
   docs/BDOS-CCS-Endpoints.md.

   Everything here is best-effort and silent. If the endpoints are not
   deployed yet, or the machine is offline, or a request fails, syncing
   switches itself off for the session and the app carries on saving to
   localStorage exactly as it always has. Nothing in the app waits on a
   response, and no failure here is ever allowed to interrupt somebody
   filling in a form.
   ======================================================================= */

const SYNC_ROOT   = '/ccs';
const SYNCED_KEY  = 'ccs.syncedAt';    // when we last pushed the draft up
const PUSH_DELAY  = 5000;              // draft pushes are lazy, not per-keystroke

let syncOn      = false;               // did the probe find the endpoints?
let pushTimer   = null;
let pushing     = false;
let pendingPush = null;
const profileIds = new Map();          // profile name → row id, for deletes

/* -----------------------------------------------------------------------
   The one place a request is made
   ----------------------------------------------------------------------- */
async function ccsFetch (path, opts) {
  const token = Auth.token();
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(Auth.BASE + SYNC_ROOT + path, Object.assign({}, opts, {
    headers: Object.assign(
      { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      (opts && opts.headers) || {}
    )
  }));

  // 404 means BDOS has not shipped these routes yet — that is expected, and
  // the app is designed to work without them. 401/403 mean this session is
  // not welcome here; either way, stop asking.
  if (!res.ok) {
    const err = new Error('CCS sync: ' + res.status + ' on ' + path);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function markSynced () {
  try { localStorage.setItem(SYNCED_KEY, new Date().toISOString()); } catch (e) {}
}

function lastSynced () {
  try { return localStorage.getItem(SYNCED_KEY); } catch (e) { return null; }
}

/** Is this form still untouched? Then adopting a saved draft costs nothing. */
function isBlankForm (S) {
  return !S || (!String(S.consultant && S.consultant.name || '').trim() && !S.mode);
}

/* -----------------------------------------------------------------------
   Draft — the form currently open. One row, shared: picking it up on
   another machine is the whole reason this file exists.
   ----------------------------------------------------------------------- */
async function pullDraft () {
  const body = await ccsFetch('/draft', { method: 'GET' });
  return (body && body.draft) || null;
}

async function flushDraft () {
  if (!syncOn || pushing || !pendingPush) return;
  pushing = true;
  const payload = pendingPush;
  pendingPush = null;
  try {
    await ccsFetch('/draft', { method: 'PUT', body: JSON.stringify({ data: payload }) });
    markSynced();
  } catch (err) {
    if (err.status === 404 || err.status === 403) syncOn = false;
    console.warn(err.message || err);
  } finally {
    pushing = false;
    if (pendingPush) flushDraft();          // something changed while we were away
  }
}

/** Queue the draft for upload. Cheap to call on every autosave. */
function pushDraft (S) {
  if (!syncOn) return;
  pendingPush = JSON.parse(JSON.stringify(S));
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flushDraft, PUSH_DELAY);
}

/* -----------------------------------------------------------------------
   Profiles — shared by every account that can sign in
   ----------------------------------------------------------------------- */
async function pullProfiles () {
  const body = await ccsFetch('/profiles', { method: 'GET' });
  const list = (body && body.profiles) || [];
  profileIds.clear();
  list.forEach(p => profileIds.set(p.name, p.id));
  return list;
}

async function pushProfile (name, S) {
  if (!syncOn) return;
  try {
    const body = await ccsFetch('/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: name, data: S })
    });
    if (body && body.profile) profileIds.set(body.profile.name, body.profile.id);
  } catch (err) {
    if (err.status === 404 || err.status === 403) syncOn = false;
    console.warn(err.message || err);
  }
}

async function deleteProfile (name) {
  if (!syncOn) return;
  const id = profileIds.get(name);
  if (id === undefined) return;             // never made it up there
  try {
    await ccsFetch('/profiles/' + encodeURIComponent(id), { method: 'DELETE' });
    profileIds.delete(name);
  } catch (err) {
    if (err.status === 404) { profileIds.delete(name); return; }   // already gone
    console.warn(err.message || err);
  }
}

/**
 * Reconcile the shared profile list with this browser's copy.
 * A name on one side and not the other is a profile somebody saved; both
 * survive. A name on both sides keeps the copy already in this browser,
 * which is the one whose owner is sitting here.
 */
async function mergeProfiles () {
  const remote = await pullProfiles();
  const local  = Store.profiles();
  let gained = 0;

  remote.forEach(p => {
    if (local[p.name] === undefined && p.data) {
      Store.saveProfile(p.name, mergeDefaults(p.data));
      gained++;
    }
  });

  const known = new Set(remote.map(p => p.name));
  const toPush = Object.keys(local).filter(n => !known.has(n));
  for (const name of toPush) await pushProfile(name, local[name]);

  return { gained: gained, sent: toPush.length };
}

/* -----------------------------------------------------------------------
   Claims history — shared, written when documents are generated
   ----------------------------------------------------------------------- */
function claimRecord (S, documents) {
  const t = invoiceTotals(S);
  return {
    consultant:   String(S.consultant.name || '').trim(),
    period_month: (Number(S.timesheet.month) || 0) + 1,     // 1-12 for the API
    period_year:  Number(S.timesheet.year) || null,
    invoice_no:   S.invoice.no || null,
    amount:       t.total,
    documents:    documents || [],
    data:         JSON.parse(JSON.stringify(S))
  };
}

async function recordClaim (S, documents) {
  if (!syncOn) return null;
  try {
    const body = await ccsFetch('/claims', {
      method: 'POST',
      body: JSON.stringify(claimRecord(S, documents))
    });
    return (body && body.claim) || null;
  } catch (err) {
    if (err.status === 404 || err.status === 403) syncOn = false;
    console.warn(err.message || err);
    return null;
  }
}

async function claimHistory (limit) {
  if (!syncOn) return [];
  try {
    const body = await ccsFetch('/claims?limit=' + (limit || 50), { method: 'GET' });
    return (body && body.claims) || [];
  } catch (err) { return []; }
}

/* -----------------------------------------------------------------------
   Submissions — a claim on its way through the approvals

   Unlike everything else here, these are not best-effort. A claim that
   silently failed to reach the project manager is worse than one that was
   never sent, so these throw and the caller says so out loud.
   ----------------------------------------------------------------------- */

/** What this account may do — BDOS decides, not the browser. */
async function whoAmI () {
  return ccsFetch('/me', { method: 'GET' });
}

/** Send a claim off for approval. */
async function submitClaim (S, note) {
  const body = await ccsFetch('/submissions', {
    method: 'POST',
    body: JSON.stringify({
      consultant: String(S.consultant.name || '').trim(),
      period_month: (Number(S.timesheet.month) || 0) + 1,
      period_year: Number(S.timesheet.year) || null,
      invoice_no: S.invoice.no || null,
      note: note || '',
      data: S
    })
  });
  return (body && body.submission) || null;
}

/**
 * @param {string} scope  '' for everything, 'open' for what is unfinished,
 *                        or one status; `mine` narrows to this account's own
 */
async function listSubmissions (scope, mine) {
  const q = [];
  if (scope) q.push('status=' + encodeURIComponent(scope));
  if (mine) q.push('mine=1');
  const body = await ccsFetch('/submissions' + (q.length ? '?' + q.join('&') : ''),
                              { method: 'GET' });
  return (body && body.submissions) || [];
}

/** One claim, with the form itself — what an approver reads before deciding. */
async function getSubmission (id) {
  const body = await ccsFetch('/submissions/' + encodeURIComponent(id), { method: 'GET' });
  return (body && body.submission) || null;
}

/**
 * Move a claim along, or send it back.
 * @param {string} action  'approve' | 'return' | 'resubmit'
 * @param {object} [data]  the form again, when this step signed it
 */
async function actOnSubmission (id, action, note, data) {
  const body = await ccsFetch('/submissions/' + encodeURIComponent(id) + '/action', {
    method: 'POST',
    body: JSON.stringify({ action: action, note: note || '', data: data || undefined })
  });
  return (body && body.submission) || null;
}

/* =======================================================================
   Start-up

   Probes the draft endpoint once. That single call answers everything we
   need to know: are the routes there, and is this account allowed through
   them. Anything other than a clean 200 turns syncing off for the session.
   ======================================================================= */

/**
 * @param {object}   S        the state the app just loaded from localStorage
 * @param {function} adopt    called with a state object to load, if the
 *                            database is holding newer work than this browser
 * @returns {Promise<object>} { on, adopted, gained, sent }
 */
async function initSync (S, adopt) {
  const result = { on: false, adopted: false, gained: 0, sent: 0 };
  if (!Auth.token()) return result;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return result;

  let draft;
  try {
    draft = await pullDraft();
  } catch (err) {
    // Not deployed yet, not permitted, or unreachable — all the same to us.
    console.info('CCS sync unavailable; working from this browser only.');
    return result;
  }

  syncOn = true;
  result.on = true;

  if (draft && draft.data) {
    const mine = lastSynced();
    // Adopt when there is nothing here to lose, or when the stored draft is
    // demonstrably newer than the last thing this browser sent up. Anything
    // less certain leaves the work on screen alone — it wins by default and
    // goes up on the next autosave.
    if (isBlankForm(S)) {
      adopt(mergeDefaults(draft.data));
      result.adopted = true;
    } else if (mine && draft.updated_at && draft.updated_at > mine) {
      const when = new Date(draft.updated_at).toLocaleString();
      const who = draft.updated_by ? ' by ' + draft.updated_by : '';
      if (confirm('A newer draft was saved' + who + ' on ' + when + '.\n\nLoad it? Your current form will be replaced.')) {
        adopt(mergeDefaults(draft.data));
        result.adopted = true;
      }
    }
  }

  try {
    const merged = await mergeProfiles();
    result.gained = merged.gained;
    result.sent = merged.sent;
  } catch (err) { console.warn(err.message || err); }

  return result;
}

/** Forget this browser's sync bookkeeping (used by Reset All). */
function forgetSync () {
  try { localStorage.removeItem(SYNCED_KEY); } catch (e) {}
  profileIds.clear();
  pendingPush = null;
  clearTimeout(pushTimer);
}

const Sync = {
  init: initSync,
  me: whoAmI,
  submit: submitClaim,
  submissions: listSubmissions,
  submission: getSubmission,
  act: actOnSubmission,
  pushDraft: pushDraft,
  pushProfile: pushProfile,
  deleteProfile: deleteProfile,
  recordClaim: recordClaim,
  history: claimHistory,
  forget: forgetSync,
  get on () { return syncOn; }
};
