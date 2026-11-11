import {API_BASE_URL} from './server-config.js';
const $ = id => document.getElementById(id);
const testing = new URLSearchParams(location.search).has('test');
const PENDING_KEY = 'kimi-pending-score-v1';
let generation = 0, refreshVersion = 0, tokenPromise = Promise.resolve(null);
let finalScore = null, token = null, saved = false, busy = false, replayLocked = false;
let qualified = null, currentEntry = null;

async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
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

function remember() {
  if (testing || !token || finalScore === null) return;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({token, score: finalScore})); } catch {}
}
function forget() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY));
    if (pending?.token === token) localStorage.removeItem(PENDING_KEY);
  } catch {}
}
export function restorePendingScore() {
  if (testing) return null;
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY));
    if (typeof pending?.token !== 'string' || pending.token.length < 20 || pending.token.length > 100 ||
        !Number.isInteger(pending.score) || pending.score < 0 || pending.score > 165) return null;
    tokenPromise = Promise.resolve({token: pending.token});
    return pending.score;
  } catch { return null; }
}

export function resetLeaderboard() {
  generation++; refreshVersion++;
  finalScore = null; token = null; saved = false; busy = false; replayLocked = false;
  qualified = null; currentEntry = null; tokenPromise = Promise.resolve(null);
  $('refresh-scores').disabled = false;
  $('score-status').textContent = ''; $('leaderboard-status').textContent = '';
  render([]); $('leaderboard-empty').hidden = true;
  controls();
}

export function beginLeaderboardRun() {
  tokenPromise = testing ? Promise.resolve(null) : api('runs', {}).catch(error => ({error}));
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
  remember(); controls();
  $('score-status').textContent = name === undefined ? 'Saving your score…' : 'Saving your name…';
  try {
    const body = {token, score: finalScore};
    if (name !== undefined) body.name = name;
    const data = await api('scores', body);
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
      try { localStorage.setItem('kimi-player-name', data.entry.name); } catch {}
      $('score-status').textContent = `Score saved! Your rank is #${data.entry.rank}.`;
    } else {
      qualified = true; replayLocked = true;
      $('score-status').textContent = 'Score saved as —. Enter your name to unlock REPLAY.';
    }
  } catch (error) {
    if (current !== generation) return;
    $('score-status').textContent = error.message;
    // An expired, unsubmitted game cannot be recovered; avoid trapping the player forever.
    if ([400, 410].includes(error.status)) {
      forget(); token = null; replayLocked = false;
    } else {
      replayLocked = qualified !== false;
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
  if (!saved && token && finalScore !== null) persist();
});
try { $('player-name').value = localStorage.getItem('kimi-player-name') || ''; } catch {}
$('score-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('save-score').disabled) return;
  const name = $('player-name').value.trim();
  if (!name) { $('player-name').focus(); return; }
  persist(name);
});
