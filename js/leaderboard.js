import {API_BASE_URL} from './server-config.js';
const $ = id => document.getElementById(id);
const testing = new URLSearchParams(location.search).has('test');
let refreshVersion = 0, generation = 0, tokenPromise = Promise.resolve(null), finalScore = null, saved = false;

async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: controller.signal,
  }).catch(() => { throw new Error(controller.signal.aborted ? 'Slow connection. Try again: your score will not be saved twice.' : 'Unable to connect to the leaderboard. Please try again.'); });
  const data = await response.json().catch(() => { throw new Error('Leaderboard unavailable. Please try again shortly.'); });
  if (!response.ok) throw new Error(data.error || 'Leaderboard unavailable. Please try again.');
  return data;
  } finally { clearTimeout(timeout); }
}

function render(entries, selectedId) {
  $('leaderboard-rows').replaceChildren();
  $('leaderboard-empty').hidden = entries.length > 0;
  for (let index = 0; index < 5; index++) {
    const entry = entries[index];
    const row = document.createElement('li');
    row.setAttribute('aria-label', entry ? `${index + 1}. ${entry.name}, ${entry.score} points` : `${index + 1}. Open spot`);
    if (entry?.id === selectedId && entry) row.className = 'your-score';
    const name = document.createElement('span'), value = document.createElement('span');
    name.className = 'top-name'; value.className = 'top-score';
    name.textContent = entry?.name || '';
    name.title = entry?.name || '';
    value.textContent = entry ? String(entry.score) : '';
    // Cover the dashes baked into the artwork only for occupied places.
    value.hidden = !entry;
    row.append(name, value);
    $('leaderboard-rows').append(row);
  }
}

export function resetLeaderboard() {
  generation++;
  finalScore = null;
  saved = false;
  tokenPromise = Promise.resolve(null);
  $('save-score').disabled = true;
  $('refresh-scores').disabled = false;
  $('player-name').disabled = false;
  $('save-score').setAttribute('aria-label', 'Save score');
  $('score-status').textContent = '';
  $('leaderboard-status').textContent = '';
  render([]);
  $('leaderboard-empty').hidden = true;
}

export function beginLeaderboardRun() {
  // Failure never prevents a local game; show its cause at the end.
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
    if (current === generation && request === refreshVersion) $('leaderboard-status').textContent = 'Leaderboard unavailable. Tap ↻ to try again.';
  } finally {
    if (current === generation) $('refresh-scores').disabled = false;
  }
}

export async function showLeaderboard(score) {
  finalScore = score;
  const current = generation;
  refresh();
  const result = await tokenPromise;
  if (current !== generation) return;
  $('save-score').disabled = !result?.token;
  $('score-status').textContent = testing ? 'Test game: scores are not saved.' :
    result?.token ? 'Enter your name to share your score.' :
    'Unranked game: unable to connect at the start. Play again when connected.';
}

$('refresh-scores').addEventListener('click', refresh);
try { $('player-name').value = localStorage.getItem('kimi-player-name') || ''; } catch {}
$('score-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saved || finalScore === null || $('save-score').disabled) return;
  const name = $('player-name').value.trim();
  if (!name) { $('player-name').focus(); return; }
  const current = generation, score = finalScore;
  $('save-score').disabled = true;
  $('player-name').disabled = true;
  $('score-status').textContent = 'Saving…';
  try {
    const run = await tokenPromise;
    const data = await api('scores', {token: run.token, name, score});
    if (current !== generation) return;
    saved = true;
    refreshVersion++;
    try { localStorage.setItem('kimi-player-name', name); } catch {}
    render(data.leaderboard, data.entry.id);
    $('score-status').textContent = `Score saved! Your rank is #${data.entry.rank}.`;
    $('save-score').setAttribute('aria-label', 'Saved');
  } catch (error) {
    if (current !== generation) return;
    $('score-status').textContent = error.name === 'AbortError' ? 'Slow connection. Try again: your score will not be saved twice.' :
      error.message === 'Failed to fetch' ? 'Connection lost. Please try again.' : error.message;
    $('save-score').disabled = false;
    $('player-name').disabled = false;
  }
});
