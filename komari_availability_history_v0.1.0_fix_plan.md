# `komari-plugin-availability-history` v0.1.0 Repair Plan

> Repository: `Chen017/komari-plugin-availability-history`
>
> Current release: `v0.1.0`
>
> Target Komari: `1.5.0-fix1`
>
> Goal: fix the plugin so WebSocket observation and HTTP API registration actually work, remove unnecessary permissions/storage complexity, and correct a few availability-summary edge cases.
>
> **This is a focused repair. Do not redesign the architecture again.**

---

# 1. Current Failure

Observed plugin log:

```text
[plugin] loading availability-history
[AVAILABILITY-HISTORY] Loading plugin...
[AVAILABILITY-HISTORY] server.hook not found, WebSocket observation disabled
[API] server.route is not available, skipping route registration
[AVAILABILITY-HISTORY] Plugin loaded successfully (...)
[plugin] loaded availability-history
```

This means:

```text
plugin JS loaded
BUT
WebSocket hooks did not register
AND
HTTP API routes did not register
```

So the plugin is **not operational** despite saying "loaded successfully".

The success message is currently misleading.

---

# 2. P0 Root Cause — Wrong `load()` Lifecycle Signature

Current code:

```ts
export async function load(server: any): Promise<void> {
```

Komari 1.5.0-fix1 actually invokes plugin lifecycle as:

```text
load()
```

with no argument.

Therefore:

```ts
server === undefined
```

and these checks fail:

```ts
typeof server?.hook === 'function'
typeof server?.route === 'function'
```

This exactly explains the runtime log.

---

# 3. Required Fix — Acquire `server` via `require('server')`

Change lifecycle to:

```ts
export async function load(): Promise<void> {
  const server = require('server')
  ...
}
```

Recommended defensive form:

```ts
let server: any

export async function load(): Promise<void> {
  console.log('[AVAILABILITY-HISTORY] Loading plugin...')

  try {
    // @ts-expect-error Komari runtime module
    server = require('server')
  }
  catch (err) {
    throw new Error(
      `[AVAILABILITY-HISTORY] Failed to acquire Komari server module: ${String(err)}`
    )
  }

  if (!server || typeof server !== 'object') {
    throw new Error('[AVAILABILITY-HISTORY] Komari server module is unavailable')
  }

  if (typeof server.hook !== 'function') {
    throw new Error('[AVAILABILITY-HISTORY] server.hook is unavailable')
  }

  if (typeof server.route !== 'function') {
    throw new Error('[AVAILABILITY-HISTORY] server.route is unavailable')
  }

  ...
}
```

Important:

```text
Missing server.hook
Missing server.route
```

must cause plugin load failure.

Do **not** continue in degraded mode.

---

# 4. Remove False-Success Paths

Delete behavior like:

```ts
console.warn('server.hook not found, WebSocket observation disabled')
```

and:

```ts
console.warn('server.route is not available, skipping route registration')
```

for required capabilities.

Replace with:

```text
throw
```

because without these two APIs the plugin has no reason to be considered healthy.

Expected behavior:

```text
critical capability missing
→ plugin load fails
→ admin UI shows plugin error
```

not:

```text
critical capability missing
→ "Plugin loaded successfully"
```

---

# 5. P0 Manifest Bug — `config` Is Wrong

Current manifest uses:

```json
"config": {
```

Komari 1.5.0-fix1 uses:

```json
"configuration": {
```

Therefore the declared config schema is currently not using the real Komari manifest contract.

Change:

```json
"config"
```

to:

```json
"configuration"
```

Use the actual Komari configuration format.

Do not keep both.

---

# 6. P0 Config Loading Bug — `server.config` Is Wrong

Current code:

```ts
const config = parsePluginConfig(server?.config)
```

Komari provides:

```ts
await server.getConfig()
```

So change to:

```ts
const rawConfig = await server.getConfig()
const config = parsePluginConfig(rawConfig)
```

Use one source of truth.

Do not support both:

```text
server.config
server.getConfig()
```

unless a real compatibility need is proven.

---

# 7. Simplify Persistent Storage — Use `__storageDir__`

Komari 1.5.0-fix1 already provides a dedicated long-term plugin storage directory:

```text
data/plugin-data/<short>
```

For this plugin:

```text
data/plugin-data/availability-history
```

and injects it as:

```js
__storageDir__
```

This directory survives plugin updates/reinstalls.

Therefore stop using:

```text
/app/data/plugin-state/availability-history
```

as a custom absolute path.

Use:

```ts
declare const __storageDir__: string
```

and:

```ts
const storagePath = __storageDir__
```

---

# 8. Remove `allowAllFileAccess`

Once `__storageDir__` is used, remove:

```json
"allowAllFileAccess": true
```

from manifest.

The plugin should only need:

```json
{
  "node": true,
  "allowHooks": true,
  "allowRoutes": true,
  "timeout": 10
}
```

Smaller permission surface is preferred.

---

# 9. Remove `storage_path` Config

Delete user config:

```text
storage_path
```

Delete corresponding parsing logic from `src/config.ts`.

New config should only contain:

```text
offline_grace_seconds
retention_days
observer_heartbeat_seconds
```

Storage location is now runtime-provided:

```text
__storageDir__
```

This reduces configuration and eliminates path/sandbox errors.

---

# 10. Correct `load()` Sequence

Recommended final startup sequence:

```text
1. require('server')
2. validate server.hook / server.route / server.getConfig
3. await server.getConfig()
4. parse config
5. resolve __storageDir__
6. initialize Ledger
7. recover observer gap
8. initialize ConnectionTracker
9. register wsConnect/wsMessage/wsClose hooks
10. register summary/events/health routes
11. start observer heartbeat
12. compact ledger
13. start daily compaction timer
14. log successful load
```

Only log:

```text
Plugin loaded successfully
```

after all mandatory registrations succeed.

---

# 11. Expected Healthy Startup Log

After the fix, expected log should resemble:

```text
[plugin] loading availability-history
[AVAILABILITY-HISTORY] Loading plugin...
[AVAILABILITY-HISTORY] Registered WebSocket hooks on /api/clients/v2/rpc
[API] Routes registered for availability-history: /summary, /events, /health
[AVAILABILITY-HISTORY] Storage ready at ...
[AVAILABILITY-HISTORY] Plugin loaded successfully (session=...)
[plugin] loaded availability-history
```

Must **not** contain:

```text
server.hook not found
server.route is not available
WebSocket observation disabled
skipping route registration
```

---

# 12. P1 Summary Bug — `currentState` After Observer Gap

Current code effectively does:

```ts
const latestEvent = nodeEvents[nodeEvents.length - 1]
currentState = latestEvent.state
```

This is wrong when an observer gap occurred after that node event.

Example:

```text
Zouter online
→ Komari controller restarts
→ observer_gap
→ no post-gap node event yet
```

Correct:

```text
currentState = unknown
```

Current behavior may incorrectly return:

```text
currentState = online
```

---

# 13. Fix `currentState`

Determine whether the latest node event is still valid.

Pseudo-logic:

```ts
const latestNodeEvent = latest node_state for uuid
const latestGapAfterEvent =
  any observer_gap whose from > latestNodeEvent.at
  and whose from < windowEnd

if (latestGapAfterEvent) {
  currentState = 'unknown'
}
else {
  currentState = latestNodeEvent.state
}
```

More robust rule:

```text
observer gap invalidates state continuity
until a later node_state re-anchors it
```

Add a direct test.

---

# 14. P1 `outageCount` Bug — Overlap With Window

Current logic counts only offline events whose event timestamp itself is inside the query window.

That misses an outage like:

```text
window starts 00:00
offline started 23:50 previous day
online 00:20
```

The outage overlaps the window and should count.

Correct rule:

```text
count confirmed offline intervals
whose [offlineStart, onlineEnd/now]
overlap [windowStart, windowEnd]
```

Do not count:

```text
grace-cancelled flaps
observer gaps
```

---

# 15. P1 Zero-Observation Semantics

Current summary returns:

```text
observableSeconds = 0
uptimeRatio = 1
```

That semantically means:

```text
100% uptime with zero evidence
```

which is misleading.

Preferred API behavior:

```text
uptimeRatio = null
```

when:

```text
observableSeconds === 0
```

If keeping the current theme type temporarily prevents null, then at minimum:

```text
document zero-observable as undefined/unknown
```

and ensure the theme never formats it as `100%`.

Best fix:

```ts
uptimeRatio: number | null
```

Update the theme type only if needed.

Keep this theme change minimal.

---

# 16. Observer Coverage Semantics

For summary with no requested UUIDs:

```text
nodes: []
```

is correct.

However do not fabricate:

```text
observerCoverage.observableSeconds = full requested range
```

unless the observer actually covered that range.

Use actual observer gap history and plugin tracking start.

If plugin started only today, a 30-day query should not imply 30 days of observer coverage.

---

# 17. P1 Storage Health

Health endpoint should report the real observer checkpoint state.

Current code uses:

```ts
lastObserverHeartbeat: new Date().toISOString()
```

That only reports request time.

Prefer:

```text
actual persisted lastHeartbeatAt
```

Expose a Ledger getter:

```ts
getLastHeartbeatAt()
```

and return that.

This makes `/health` useful for debugging.

---

# 18. P1 Ledger Write Durability

Current `appendFileSync()` is acceptable for this scale, but if practical use:

```text
open
append
fsync
close
```

for committed node transitions.

This is optional for this repair if tests and runtime remain stable.

Do not add a database.

---

# 19. Keep Architecture Small

Do not introduce new abstractions while fixing this.

Keep current modules:

```text
index.ts
config.ts
types.ts
ledger.ts
tracker.ts
summary.ts
api.ts
```

Do not add:

```text
service container
repository interfaces
event bus
storage adapters
compatibility bridge
runtime facade
```

---

# 20. Required Code Changes by File

## `src/index.ts`

Change:

```ts
load(server)
```

to:

```ts
load()
```

Acquire:

```ts
require('server')
```

Use:

```ts
await server.getConfig()
```

Validate required server APIs.

Use:

```ts
__storageDir__
```

Throw on missing core capability.

---

## `komari-plugin.json`

Change:

```text
config
→ configuration
```

Remove:

```text
allowAllFileAccess
storage_path
```

Keep only required permissions.

---

## `src/config.ts`

Remove:

```text
storagePath
storage_path parsing
```

Keep:

```text
offlineGraceSeconds
retentionDays
observerHeartbeatSeconds
```

---

## `src/ledger.ts`

Constructor should receive:

```text
__storageDir__
```

No custom path config.

Add:

```text
getLastHeartbeatAt()
```

if health endpoint uses it.

---

## `src/api.ts`

Keep exact routes:

```text
/api/plugin/availability-history/v1/summary
/api/plugin/availability-history/v1/events
/api/plugin/availability-history/v1/health
```

Required route registration failures must propagate.

Do not silently skip.

Use the known Komari `server.route()` response shape; avoid extra unused compatibility branches if easy to remove.

---

## `src/summary.ts`

Fix:

```text
currentState after observer gap
outageCount overlap
zero-observable uptime semantics
observer/tracking coverage semantics
```

---

# 21. Automated Regression Tests

Add/adjust tests so the current v0.1.0 failure can never reappear.

## Test A — lifecycle has no parameter dependency

Test runtime bridge such that:

```text
load()
```

works without injected parameter.

Mock:

```text
require('server')
```

or isolate server acquisition in a helper that can be tested.

Goal:

```text
plugin no longer depends on load(server)
```

---

## Test B — missing `server.hook` fails load

Mock server without hook.

Expected:

```text
load rejects/throws
```

Not:

```text
successful degraded load
```

---

## Test C — missing `server.route` fails load

Expected:

```text
load rejects/throws
```

---

## Test D — config loaded using `server.getConfig()`

Verify plugin reads:

```text
offline_grace_seconds
retention_days
observer_heartbeat_seconds
```

from `getConfig()`.

---

## Test E — uses runtime storage directory

Verify Ledger is initialized with injected:

```text
__storageDir__
```

No custom `storage_path`.

---

## Test F — observer gap currentState

Timeline:

```text
online
observer_gap
no re-anchor
```

Expected:

```text
currentState = unknown
```

---

## Test G — observer gap + re-anchor

Timeline:

```text
online
observer_gap
online
```

Expected:

```text
currentState = online
```

---

## Test H — outage overlaps window start

Timeline:

```text
offline 10 min before window
online 20 min after window start
```

Expected:

```text
outageCount = 1
offlineSeconds includes 20 min inside window
```

---

## Test I — zero observable data

Expected:

```text
uptimeRatio = null
```

or equivalent explicitly unknown representation.

Never semantic 100%.

---

# 22. Build Verification

Run:

```bash
npm test
npm run build
```

Both must pass.

Inspect ZIP contents:

```text
komari-plugin.json
script.js
assets/icon.svg
```

Verify updated manifest in ZIP, not only repository source.

---

# 23. Reinstall Verification

After building new ZIP:

```text
disable/remove old v0.1.0 code package
install repaired package
approve permissions
enable plugin
```

Verify the new log.

If log still shows:

```text
server.hook not found
server.route is not available
```

stop immediately.

Do not continue testing uptime.

---

# 24. Health API Test

While authenticated as admin:

```text
GET /api/plugin/availability-history/v1/health
```

Expected:

```json
{
  "healthy": true,
  "storageWritable": true
}
```

Also verify:

```text
sessionId non-empty
lastObserverHeartbeat recent
trackedNodeCount reasonable
```

---

# 25. Summary API Smoke Test

Use real node UUIDs:

```text
GET /api/plugin/availability-history/v1/summary?days=30&uuids=<uuid1>,<uuid2>
```

Expected:

```text
HTTP 200
schemaVersion = 1
nodes present
```

Immediately after install, coverage will be small.

That is correct.

Do not expect 30 historical days.

---

# 26. Real Zouter Test

Pick Zouter.

### Step 1

Confirm Zouter is online.

### Step 2

Stop Agent.

Wait:

```text
> 180 seconds
```

### Step 3

Call:

```text
/events
```

Expected confirmed event:

```text
offline
```

with timestamp equal to original disconnect time.

### Step 4

Wait 5–10 minutes.

### Step 5

Restart Agent.

Expected:

```text
online
```

event.

### Step 6

Call `/summary`.

Expected:

```text
uptimeRatio < 1
```

### Step 7

Refresh Emerald page repeatedly.

Expected:

```text
uptime remains < 100%
```

This is the main acceptance test.

---

# 27. Short-Flap Test

Stop Agent for:

```text
< 180 seconds
```

and restore.

Expected:

```text
no committed offline event
```

---

# 28. Komari Controller Restart Test

With nodes healthy:

```text
restart Komari container
```

After recovery:

Expected:

```text
observer gap recorded
no all-node offline burst
no false VPS downtime
```

Check both:

```text
/events
/summary
```

---

# 29. Plugin Reload Test

Reload/reinstall plugin while Agents remain running.

Expected:

```text
wsMessage rediscovers connections
fresh post-gap online re-anchor
no false downtime
history preserved
```

---

# 30. Final Expected Log

Healthy:

```text
[plugin] loading availability-history
[AVAILABILITY-HISTORY] Loading plugin...
[AVAILABILITY-HISTORY] Registered WebSocket hooks on /api/clients/v2/rpc
[API] Routes registered for availability-history: /summary, /events, /health
[AVAILABILITY-HISTORY] Plugin loaded successfully (session=...)
[plugin] loaded availability-history
```

Unhealthy runtime capability:

```text
plugin load failed
```

Never:

```text
critical capability missing
+
Plugin loaded successfully
```

---

# 31. Definition of Done

- [ ] `load()` takes no `server` parameter.
- [ ] `require('server')` is used.
- [ ] `server.hook` missing causes load failure.
- [ ] `server.route` missing causes load failure.
- [ ] `server.getConfig()` is used.
- [ ] Manifest uses `configuration`, not `config`.
- [ ] `allowAllFileAccess` removed.
- [ ] `storage_path` config removed.
- [ ] `__storageDir__` used for persistence.
- [ ] Hooks register on `/api/clients/v2/rpc`.
- [ ] `/summary`, `/events`, `/health` actually register.
- [ ] `currentState` becomes `unknown` after observer gap until re-anchor.
- [ ] `outageCount` counts outages overlapping the query window.
- [ ] Zero-observable summaries do not semantically become 100% uptime.
- [ ] Health reports actual observer heartbeat.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Reinstalled plugin log contains no missing-hook/route warning.
- [ ] Health API returns healthy.
- [ ] Zouter real stop/start test produces persisted downtime.
- [ ] Browser refresh does not reset past downtime.
- [ ] Komari controller restart does not create fake VPS outages.
- [ ] Plugin reload preserves history and reconnects observation correctly.

---

# 32. Scope Discipline

This repair is complete when the above issues are fixed.

Do **not** use this task as an excuse to:

```text
rewrite the plugin again
add Metric Store fallback
add Telegram import
add a database
add caching
add generic abstractions
change the Emerald traffic module
```

The plugin architecture is already correct.

The immediate problem is runtime integration and a few summary edge cases.
