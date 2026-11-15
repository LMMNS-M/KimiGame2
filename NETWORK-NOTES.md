# World record and network correction — 2026-11-16

## Corrected locally

TarnStarGame derives `best` from the first server leaderboard row. KimiGame2's
initial commit f0819d6 instead read `kimi-wishes-best` and promoted the current
score before the server confirmed it. This predates statistics.

`leaderboard.js` now owns the world record, accepts it only from successful
leaderboard/scores responses and caches it in `kimi-world-best-v1`, scoped to
the API base. Personal records are neither used nor deleted. The world record
refreshes at load, START, foregrounding and reconnection, with bounded retries.
The game stays playable with cached world data or 0 when no cache exists.
The score request timeout is 12 seconds (previously 4; originally 10).

`telemetry.js` isolates loading and synchronous analytics errors. Analytics
preferences and queues are unchanged; an analytics module failure must not
prevent START or leaderboard initialization.

## Network finding and remaining limitation

The API URL remains `https://lammens-cloud.tail538586.ts.net`; it has not changed
since the initial Ubuntu integration. Public DNS resolves to Funnel public
relays, while this Ubuntu's Tailscale DNS resolves to `100.124.244.20`.
Chrome classifies the latter CGNAT range as local. Automatic statistics made
this shared destination reachable earlier, but removing statistics does not
make a denied local destination usable by the leaderboard.

An isolated Chrome 155 test, with a public HTTPS frontend origin and local
network permission denied, performed only GET /api/leaderboard:

- Public Funnel relay 176.58.90.46: HTTP 200.
- System DNS / explicitly selected 100.124.244.20: fetch rejected.

DNS overrides and permission changes existed only in disposable test browser
processes. They are not deployed or recommended as player workarounds.
No production write requests were sent. A JavaScript change cannot guarantee
public DNS resolution on arbitrary devices while retaining the same hostname.
No infrastructure, DNS, security settings or endpoint URL has been changed.

## Validation

`npm run test:world-best` uses a disposable server/database and separate
browser contexts. Chrome and WebKit cover distinct personal local records,
server TOP1 equality, delayed responses, offline recovery, anonymous scores,
name updates without duplicates, world-only cache, unavailable localStorage,
unavailable analytics module, failed statistics requests, and playable START
while the backend is unavailable. Existing leaderboard and statistics browser
suites pass on both engines. Physical iPhone/Android, Samsung Internet and
external cellular/Wi-Fi tests are not available in this environment.
