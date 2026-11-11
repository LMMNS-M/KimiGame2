import {API_BASE_URL} from './server-config.js';
import {scoreContext,scoreConfirmed} from './statistics.js';
const $ = id => document.getElementById(id);
const testing = new URLSearchParams(location.search).has('test');
const PENDING_KEY = 'kimi-pending-score-v2';
let runStarted = 0, syncBusy = false, syncTimer, syncAttempts = 0;
const uid = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
let pending = [];
try {
  pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  if (!Array.isArray(pending)) pending = [];
  const old = JSON.parse(localStorage.getItem('kimi-pending-score-v1'));
  if (old?.token && !pending.some(p => p.token === old.token)) pending.push({...old, created:Date.now()});
  localStorage.removeItem('kimi-pending-score-v1');
} catch {}
pending = pending.filter(p => typeof p?.token === 'string' && p.token.length >= 20 && Number.isInteger(p.score) && p.score >= 0 && p.score <= 165 && p.created > Date.now()-7*86400000).slice(-20);
function savePending() { try {localStorage.setItem(PENDING_KEY, JSON.stringify(pending));} catch {} renderPending(); }
let generation = 0, refreshVersion = 0, tokenPromise = Promise.resolve(null);
let finalScore = null, token = null, saved = false, busy = false, replayLocked = false;
let qualified = null, currentEntry = null;

async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${API_BASE_URL}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      keepalive: body !== undefined,
    }).catch(() => { throw new Error('Connection unavailable. Saving is not confirmed. Tap ↻ to retry.'); });
    const data = await response.json().catch(() => { throw new Error('Leaderboard unavailable. Please try again.'); });
    if (!response.ok) {
      const error = new Error(data.error || 'Leaderboard unavailable. Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally { clearTimeout(timeout); }
}

function render(entries, selectedId = currentEntry?.id) {
  $('leaderboard-rows').replaceChildren();
  $('leaderboard-empty').hidden = entries.length > 0;
  for (let index = 0; index < 5; index++) {
    const entry = entries[index], displayName = entry ? (entry.name || '—') : '';
    const row = document.createElement('li');
    row.setAttribute('aria-label', entry ? `${index + 1}. ${displayName}, ${entry.score} points` : `${index + 1}. Open spot`);
    if (entry && entry.id === selectedId) row.className = 'your-score';
    const name = document.createElement('span'), value = document.createElement('span');
    name.className = 'top-name'; value.className = 'top-score';
    name.textContent = displayName; name.title = displayName;
    value.textContent = entry ? String(entry.score) : '';
    value.hidden = !entry;
    row.append(name, value); $('leaderboard-rows').append(row);
  }
}

function controls() {
  $('replay').disabled = replayLocked;
  $('save-score').disabled = busy || saved || !token;
  $('player-name').disabled = busy || saved;
  $('save-score').setAttribute('aria-label', saved ? 'Saved' : 'Save score');
}
export function canReplay() { return !replayLocked; }

function remember(name) {
  if (testing || !token || finalScore === null) return;
  let entry = pending.find(p => p.token === token);
  if (!entry) { entry = {token, score:finalScore, started:runStarted, ended:Date.now()/1000, created:Date.now(), analytics:scoreContext()}; pending.push(entry); }
  if (name !== undefined) entry.name = name;
  pending = pending.slice(-20); savePending();
}
function forget() {pending = pending.filter(p => p.token !== token); savePending();}
async function submitPending(entry) {
  const body = {token:entry.token, score:entry.score};
  if (entry.name) body.name = entry.name;
  try {return await api('scores',body);} catch(error) {
    if (error.status !== 410 || !entry.started) throw error;
    await api('runs',{token:entry.token, deferred:true, started:entry.started, ended:entry.ended});
    return api('scores',body);
  }
}
async function syncPending() {
  if (syncBusy || testing || syncAttempts >= 8) return;
  syncBusy = true;
  let failed = false;
  for (const entry of [...pending]) {
    if (entry.token === token || (entry.confirmed && !entry.name) || entry.created < Date.now()-7*86400000) continue;
    try {
      const data = await submitPending(entry);
      if(data.entry) scoreConfirmed(data.entry.name?'score_saved':'score_qualified',data.entry,entry.analytics);
      if (data.entry && !data.entry.name) entry.confirmed = true;
      else pending = pending.filter(p => p !== entry);
    } catch(error) {
      failed = true;
      if ([400,409,410].includes(error.status)) pending = pending.filter(p => p !== entry);
      break;
    }
  }
  syncBusy = false; savePending();
  if (failed) syncTimer = setTimeout(syncPending, Math.min(300000,2000*2**syncAttempts++));
}
function renderPending() {
  const host = $('pending-list'); if (!host) return;
  host.replaceChildren();
  $('pending-open').hidden = pending.length === 0;
  for (const entry of pending) {
    const form = document.createElement('form'), label = document.createElement('label'), input = document.createElement('input'), button = document.createElement('button'), status = document.createElement('p');
    label.textContent = `${entry.score} points · ${entry.confirmed ? 'saved as —' : 'awaiting server confirmation'}`;
    input.placeholder = 'Your name'; input.setAttribute('aria-label','Your name'); input.maxLength = 20; input.required = true;
    button.textContent = 'Save name'; button.type = 'submit'; label.append(input); form.append(label,button,status); host.append(form);
    form.addEventListener('submit',async event => {
      event.preventDefault(); if (!input.value.trim()) return;
      entry.name = input.value.trim();
      try {localStorage.setItem(PENDING_KEY,JSON.stringify(pending));} catch {}
      button.disabled = true; status.textContent = 'Saving…';
      try { const data=await submitPending(entry);if(data.entry)scoreConfirmed('score_saved',data.entry,entry.analytics);pending = pending.filter(p => p !== entry); savePending(); }
      catch(error) { status.textContent = error.message; button.disabled = false; }
    });
  }
}
$('pending-open')?.addEventListener('click',()=>{renderPending();$('pending-dialog').showModal();});
$('pending-close')?.addEventListener('click',()=>$('pending-dialog').close());
setTimeout(syncPending,0);

export function resetLeaderboard() {
  generation++; refreshVersion++;
  finalScore = null; token = null; saved = false; busy = false; replayLocked = false;
  qualified = null; currentEntry = null; tokenPromise = Promise.resolve(null);
  $('player-name').value = '';
  syncAttempts = 0; setTimeout(syncPending,0);
  $('refresh-scores').disabled = false;
  $('score-status').textContent = ''; $('leaderboard-status').textContent = '';
  render([]); $('leaderboard-empty').hidden = true;
  controls();
}

export function beginLeaderboardRun() {
  runStarted = Date.now()/1000;
  const localToken = uid();
  tokenPromise = testing ? Promise.resolve(null) : api('runs', {token:localToken}).catch(() => ({token:localToken}));
}

async function refresh() {
  const current = generation, request = ++refreshVersion;
  $('leaderboard-empty').hidden = true;
  $('refresh-scores').disabled = true;
  $('leaderboard-status').textContent = 'Loading…';
  try {
    const data = testing ? {leaderboard: []} : await api('leaderboard');
    if (current !== generation || request !== refreshVersion) return;
    render(data.leaderboard);
    $('leaderboard-status').textContent = testing ? 'Test mode: no scores published.' : '';
  } catch {
    if (current === generation && request === refreshVersion)
      $('leaderboard-status').textContent = 'Leaderboard unavailable. Tap ↻ to retry.';
  } finally {
    if (current === generation) $('refresh-scores').disabled = false;
  }
}

async function persist(name) {
  if (busy || saved || !token || finalScore === null) return;
  const current = generation;
  busy = true;
  // Store only the private recovery capability locally. The score itself lives in SQLite.
  remember(name); controls();
  $('score-status').textContent = name === undefined ? 'Saving your score…' : 'Saving your name…';
  try {
    const pendingResult = pending.find(p => p.token === token);
    const data = await submitPending(pendingResult);
    if (current !== generation) return;
    refreshVersion++;
    currentEntry = data.entry;
    render(data.leaderboard);
    $('leaderboard-status').textContent = '';
    if (!data.entry) {
      qualified = false; replayLocked = false; forget();
      $('score-status').textContent = 'Enter your name to share your score.';
    } else if (data.entry.name) {
      saved = true; replayLocked = false; forget();
      $('player-name').value = data.entry.name;
      scoreConfirmed('score_saved', data.entry, pendingResult.analytics);
      $('score-status').textContent = `Score saved! Your rank is #${data.entry.rank}.`;
    } else {
      if (qualified !== true) scoreConfirmed('score_qualified', data.entry, pendingResult.analytics);
      qualified = true; replayLocked = true;
      const pendingEntry = pending.find(p => p.token === token);
      if (pendingEntry) {pendingEntry.confirmed = true; savePending();}
      $('score-status').textContent = 'Score saved as —. Enter your name to unlock REPLAY.';
    }
  } catch (error) {
    if (current !== generation) return;
    $('score-status').textContent = error.message;
    // An expired, unsubmitted game cannot be recovered; avoid trapping the player forever.
    if ([400, 410].includes(error.status)) {
      forget(); token = null; replayLocked = false;
    } else {
      // A failed service must not trap the player. The capability stays queued.
      replayLocked = false;
    }
  } finally {
    if (current === generation) { busy = false; controls(); }
  }
}

export async function showLeaderboard(score) {
  finalScore = score;
  const current = generation;
  replayLocked = !testing; controls();
  refresh();
  const result = await tokenPromise;
  if (current !== generation) return;
  token = result?.token || null;
  if (!token) {
    replayLocked = false; controls();
    $('score-status').textContent = testing ? 'Test game: scores are not saved.' :
      'Unranked game: unable to connect at the start. Play again when connected.';
    return;
  }
  await persist();
}

$('refresh-scores').addEventListener('click', () => {
  refresh();
  if (!saved && token && finalScore !== null) persist();
});
window.addEventListener('online', () => {
  syncAttempts = 0; clearTimeout(syncTimer); syncPending();
  if (!saved && token && finalScore !== null) persist();
});
$('score-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('save-score').disabled) return;
  const name = $('player-name').value.trim();
  if (!name) { $('player-name').focus(); return; }
  persist(name);
});
