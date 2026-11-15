// Analytics is optional: a missing module or synchronous failure cannot stop the game.
let statistics;
const ready = import('./statistics.js').then(module => { statistics = module; }).catch(() => {});
function safely(name, ...args) {
  try { return statistics?.[name](...args); } catch { return undefined; }
}
export function initializeStatistics(snapshot) { void ready.then(() => safely('initializeStatistics', snapshot)); }
export function track(...args) { void ready.then(() => safely('track', ...args)); }
export function gameStarted(...args) { void ready.then(() => safely('gameStarted', ...args)); }
export function gameComplete(...args) { void ready.then(() => safely('gameComplete', ...args)); }
export function scoreConfirmed(...args) { void ready.then(() => safely('scoreConfirmed', ...args)); }
export function scoreContext() { return safely('scoreContext') ?? null; }
