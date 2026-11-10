import {API_BASE_URL} from './server-config.js';
const $ = id => document.getElementById(id);
const testing = new URLSearchParams(location.search).has('test');
let generation = 0, tokenPromise = Promise.resolve(null), finalScore = null, saved = false;

async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: controller.signal,
  }).catch(() => { throw new Error(controller.signal.aborted ? 'Connexion lente. Réessaie : aucun doublon ne sera créé.' : 'Connexion au classement impossible. Réessaie.'); });
  const data = await response.json().catch(() => { throw new Error('Classement indisponible. Réessaie dans un instant.'); });
  if (!response.ok) throw new Error(data.error || 'Classement indisponible. Réessayez.');
  return data;
  } finally { clearTimeout(timeout); }
}

function render(entries, selectedId) {
  $('leaderboard-rows').replaceChildren();
  $('leaderboard-empty').hidden = entries.length > 0;
  for (const entry of entries) {
    const row = document.createElement('tr');
    if (entry.id === selectedId) row.className = 'your-score';
    for (const value of [entry.rank, entry.name, entry.score]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
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
  $('save-score').textContent = 'Enregistrer';
  $('score-status').textContent = '';
  $('leaderboard-status').textContent = '';
  render([]);
}

export function beginLeaderboardRun() {
  // Failure never prevents a local game; show its cause at the end.
  tokenPromise = testing ? Promise.resolve(null) : api('runs', {}).catch(error => ({error}));
}

async function refresh() {
  const current = generation;
  $('refresh-scores').disabled = true;
  $('leaderboard-status').textContent = 'Chargement…';
  try {
    const data = testing ? {leaderboard: []} : await api('leaderboard');
    if (current !== generation) return;
    render(data.leaderboard);
    $('leaderboard-status').textContent = testing ? 'Mode test : aucun score publié.' : '';
  } catch {
    if (current === generation) $('leaderboard-status').textContent = 'Classement indisponible. Réessayez avec ↻.';
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
  $('score-status').textContent = testing ? 'Partie de test, sans enregistrement.' :
    result?.token ? 'Ajoute ton pseudo pour partager ton score.' :
    'Partie hors classement : connexion impossible au démarrage. Rejoue une fois connecté.';
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
  $('score-status').textContent = 'Enregistrement…';
  try {
    const run = await tokenPromise;
    const data = await api('scores', {token: run.token, name, score});
    if (current !== generation) return;
    saved = true;
    try { localStorage.setItem('kimi-player-name', name); } catch {}
    render(data.leaderboard, data.entry.id);
    $('score-status').textContent = `Score enregistré ! Tu es n° ${data.entry.rank}.`;
    $('save-score').textContent = 'Enregistré ✓';
  } catch (error) {
    if (current !== generation) return;
    $('score-status').textContent = error.name === 'AbortError' ? 'Connexion lente. Réessaie : aucun doublon ne sera créé.' :
      error.message === 'Failed to fetch' ? 'Connexion interrompue. Réessaie.' : error.message;
    $('save-score').disabled = false;
    $('player-name').disabled = false;
  }
});
