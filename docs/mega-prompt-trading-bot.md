# Mega Prompt: ClaudeClaw + Regime Trader Integration

> **Target**: Claude Code (autonomous agent mode)
> **Framework**: ReAct + Stop Conditions
> **Strategy**: Integrates existing Python trading system (regime-trader) with existing Node.js Telegram bot (ClaudeClaw). Fixes reliability bugs first, then builds a file-based integration bridge, then wires up Telegram commands and headless operation. No trading logic is rebuilt in TypeScript.

---

## PROMPT

```
You are implementing a trading integration for ClaudeClaw, a Telegram bot (Node.js/TypeScript). You are NOT building a trading system from scratch. A working Python trading system called "regime-trader" already exists at C:\Projects\regime-trader\ with:

- HMM-based regime detection (Hidden Markov Model, 22 technical features)
- Multi-instance architecture (spy-aggressive, spy-conservative, default)
- Alpaca API integration (paper + live trading)
- 134 passing tests, backtested results (+171% aggressive, +109% default)
- Real-time state output via JSON files at instances/<name>/data/state.json
- Instance management CLI (instance_manager.py)
- Circuit breakers, risk management, position limits all built-in

Your job: Make ClaudeClaw the command-and-control interface for regime-trader via Telegram.

## STARTING STATE

ClaudeClaw project: current working directory
regime-trader project: C:\Projects\regime-trader\

ClaudeClaw has 7 code review findings that MUST be fixed before adding any new modules:

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| 1 | P0 | src/index.ts:86-103 | acquireLock() busy-wait spin blocks event loop for 1s |
| 2 | P0 | src/index.ts:195-203, src/state.ts:67 | No graceful shutdown of in-flight agent queries |
| 3 | P1 | src/scheduler.ts:58 | 60-second polling interval too slow for trading alerts |
| 4 | P1 | src/scheduler.ts:69-80, src/db.ts | No idempotency guard on task execution after crash |
| 5 | P1 | (new file) | No process supervision (pm2/systemd) |
| 6 | P1 | src/dashboard.ts | No rate limiting on dashboard API |
| 7 | P2 | src/db.ts:62 | decryptField silently returns ciphertext on failure |

## TARGET STATE

1. All 7 review findings fixed
2. ClaudeClaw can monitor regime-trader instances via state.json polling
3. Telegram commands let user control trading (status, halt, resume, start, stop)
4. Proactive Telegram alerts on regime changes and circuit breaker events
5. Both projects run headlessly via pm2
6. All code typechecks, builds, and tests pass

## ARCHITECTURE

```
┌──────────────────────────┐          ┌──────────────────────────┐
│ ClaudeClaw (Node.js)     │          │ regime-trader (Python)   │
│                          │  file    │                          │
│  src/trading/            │  poll    │  instances/              │
│    state-poller.ts ──────┼─────────→│    spy-aggressive/       │
│    alerts.ts ────────────┼──alert──→│      data/state.json     │
│    instance-control.ts ──┼─subprocess│    spy-conservative/     │
│    telegram-commands.ts  │          │      data/state.json     │
│                          │          │                          │
│  Telegram ← user cmds   │  ctrl    │  instance_manager.py     │
│  /trade status           │─────────→│    start/stop/halt/list  │
│  /trade halt             │          │                          │
│  /trade regime           │          │  Alpaca API (paper/live) │
└──────────────────────────┘          └──────────────────────────┘
```

NO trading logic in TypeScript. ClaudeClaw = UI + control. regime-trader = brain + execution.

---

## PHASE 1: Fix 7 Review Findings

Do these first. Do not touch anything else until all 7 are fixed and verified.

### Fix 1 (P0): Replace busy-wait spin lock

File: src/index.ts, function acquireLock() at line 86.

Current code (BAD):
```typescript
const deadline = Date.now() + 1000;
while (Date.now() < deadline) { /* spin */ }
```

Replace with:
```typescript
import { execSync } from 'child_process';

// In acquireLock():
try {
  process.kill(old, 'SIGTERM');
  execSync(process.platform === 'win32' ? 'timeout /t 1 /nobreak >nul 2>&1' : 'sleep 1');
} catch { /* already dead */ }
```

execSync blocks the thread but yields to the OS scheduler, unlike a JS spin loop. This is a startup-only path so blocking is acceptable here.

### Fix 2 (P0): Graceful shutdown of in-flight operations

Two files need changes:

**src/state.ts** -- Add this export after the existing `abortActiveQuery` function:
```typescript
export function abortAllActiveQueries(): number {
  let count = 0;
  for (const [, ctrl] of _activeAbort) {
    ctrl.abort();
    count++;
  }
  _activeAbort.clear();
  return count;
}
```

**src/message-queue.ts** -- Add a drain() method that returns a Promise resolving when the currently-executing task (if any) completes. Read the file first to understand the queue implementation, then add:
```typescript
drain(): Promise<void> {
  // If nothing is running, resolve immediately
  // If something is running, return a promise that resolves when it finishes
}
```

**src/index.ts** -- Update the shutdown handler at line 195:
```typescript
const shutdown = async () => {
  logger.info('Shutting down...');
  setTelegramConnected(false);

  const aborted = abortAllActiveQueries();
  if (aborted > 0) logger.info({ aborted }, 'Aborted in-flight queries');

  // Wait up to 5s for current message processing to finish
  await Promise.race([
    messageQueue.drain(),
    new Promise(r => setTimeout(r, 5000)),
  ]);

  releaseLock();
  await bot.stop();
  process.exit(0);
};
```

Import `abortAllActiveQueries` from './state.js' and `messageQueue` from './message-queue.js'.

### Fix 3 (P1): Precision scheduler timer

File: src/scheduler.ts

Replace `setInterval(() => void runDueTasks(), 60_000)` at line 58 with:

```typescript
// In initScheduler():
void scheduleNextTick();

// New function:
async function scheduleNextTick(): Promise<void> {
  await runDueTasks();
  const nextDueMs = getNextDueTimeMs(schedulerAgentId);
  const delay = nextDueMs
    ? Math.max(1000, Math.min(nextDueMs - Date.now(), 60_000))
    : 60_000;
  setTimeout(() => void scheduleNextTick(), delay);
}
```

Add to src/db.ts:
```typescript
export function getNextDueTimeMs(agentId: string): number | null {
  const row = db.prepare(
    `SELECT MIN(next_run) as next FROM scheduled_tasks WHERE status = 'active' AND agent_id = ?`
  ).get(agentId) as { next: number | null } | undefined;
  return row?.next ? row.next * 1000 : null;
}
```

### Fix 4 (P1): Idempotency guard for scheduled tasks

File: src/scheduler.ts

Add execution nonce. Before executing a task, generate a UUID and use an atomic DB claim:

```typescript
import { randomUUID } from 'crypto';

// In runDueTasks(), replace markTaskRunning(task.id, nextRun) with:
const nonce = randomUUID();
const claimed = claimTaskExecution(task.id, nonce, nextRun);
if (!claimed) {
  logger.warn({ taskId: task.id }, 'Task already claimed, skipping');
  continue;
}
```

Add to src/db.ts:
```typescript
export function claimTaskExecution(taskId: string, nonce: string, nextRun: number): boolean {
  const result = db.prepare(
    `UPDATE scheduled_tasks SET status = 'running', next_run = ?
     WHERE id = ? AND status = 'active'`
  ).run(nextRun, taskId);
  return result.changes > 0;
}
```

Note: The existing `markTaskRunning` already does a status check, but wrapping it in this function makes the claim pattern explicit and prevents the race between `getDueTasks` and `markTaskRunning`. The nonce is available for future audit logging.

### Fix 5 (P1): pm2 process supervision

Create ecosystem.config.cjs at project root:

```javascript
module.exports = {
  apps: [
    {
      name: 'claudeclaw-main',
      script: 'dist/index.js',
      node_args: '--enable-source-maps',
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
      autorestart: true,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
    },
  ],
};
```

Add to package.json scripts:
```json
"pm2:start": "pm2 start ecosystem.config.cjs",
"pm2:stop": "pm2 stop ecosystem.config.cjs",
"pm2:restart": "pm2 restart ecosystem.config.cjs",
"pm2:logs": "pm2 logs"
```

Create logs/ directory. Add logs/ to .gitignore if not already there.

IMPORTANT: On Windows, do NOT use .cmd shims. The script path `dist/index.js` with direct node is fine.

### Fix 6 (P1): Dashboard rate limiting

File: src/dashboard.ts

Add a simple in-memory token bucket rate limiter BEFORE the auth middleware. No new dependencies.

```typescript
const rateLimiter = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateLimiter.get(ip);
  if (!bucket || now - bucket.lastRefill > RATE_WINDOW_MS) {
    bucket = { tokens: RATE_LIMIT, lastRefill: now };
    rateLimiter.set(ip, bucket);
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}
```

Add as Hono middleware:
```typescript
app.use('/api/*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  await next();
});
```

Place this BEFORE the existing auth middleware.

### Fix 7 (P2): Fix silent decryption failure

File: src/db.ts, the decryptField function around line 62.

Current code returns ciphertext silently on ANY error. Change the catch block:

```typescript
} catch (err) {
  // Our encrypted format is "iv:authTag:data" (3 colon-separated hex segments).
  // If the input matches this format but decryption failed, that's a real error.
  const parts = ciphertext.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-f]+$/i.test(p))) {
    logger.error({ err }, 'Decryption failed for data matching encrypted format');
    throw new Error('Decryption failed: possible key mismatch or data corruption');
  }
  // Doesn't look encrypted -- return as pre-encryption plaintext
  return ciphertext;
}
```

Import logger at top of db.ts if not already imported.

### STOP CONDITION 1

Run these commands and verify all pass:
```bash
npm run typecheck
npm run build
npm test
```

Read back each modified file at the changed lines to confirm correctness.
DO NOT proceed to Phase 2 until all pass. If any fail, fix and re-verify.

---

## PHASE 2: Regime Trader Integration Bridge

Create src/trading/ directory with the following modules. The regime-trader project is at C:\Projects\regime-trader\.

### src/trading/types.ts

Define TypeScript types that mirror regime-trader's state.json structure. Read C:\Projects\regime-trader\data\state.json (or an instance's state.json) to understand the exact shape. Key types:

```typescript
export type RegimeLabel = 'CRASH' | 'STRONG_BEAR' | 'WEAK_BEAR' | 'NEUTRAL' | 'WEAK_BULL' | 'STRONG_BULL' | 'EUPHORIA';

export interface RegimeState {
  label: RegimeLabel;
  confidence: number;
  stability_bars: number;
  is_stable: boolean;
  flicker_rate: number;
  vol_rank: number;
}

export interface InstanceState {
  mode: 'paper' | 'live' | 'backtest';
  equity: number;
  cash: number;
  regime: RegimeState;
  positions: Array<{
    symbol: string;
    qty: number;
    entry_price: number;
    current_price: number;
    unrealized_pnl: number;
  }>;
  risk: {
    daily_drawdown_pct: number;
    peak_drawdown_pct: number;
    circuit_breakers: Record<string, boolean>;
  };
  recent_signals: Array<{
    timestamp: string;
    regime: string;
    signal: string;
    allocation: number;
  }>;
  updated_at: string;
}

export interface TradingAlert {
  type: 'regime_change' | 'circuit_breaker' | 'large_pnl' | 'instance_down' | 'instance_halted';
  instance: string;
  message: string;
  timestamp: number;
}
```

IMPORTANT: Read the actual state.json files from regime-trader to get the exact field names. The types above are approximate -- match the real data.

### src/trading/state-poller.ts

Polls state.json from each configured regime-trader instance.

```typescript
import { readFile, access } from 'fs/promises';
import { EventEmitter } from 'events';

export class StatePoller extends EventEmitter {
  private instances: Map<string, InstanceState> = new Map();
  private previousRegimes: Map<string, string> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private basePath: string,      // C:\Projects\regime-trader
    private instanceNames: string[], // ['spy-aggressive', 'spy-conservative']
    private intervalMs = 5000,
  ) { super(); }

  start(): void { /* poll loop */ }
  stop(): void { /* clear timer */ }

  private async pollInstance(name: string): Promise<void> {
    const stateFile = path.join(this.basePath, 'instances', name, 'data', 'state.json');
    try {
      const raw = await readFile(stateFile, 'utf8');
      const state: InstanceState = JSON.parse(raw);
      const prevRegime = this.previousRegimes.get(name);

      // Detect regime change
      if (prevRegime && prevRegime !== state.regime.label) {
        this.emit('regime_change', { instance: name, from: prevRegime, to: state.regime.label });
      }

      // Detect circuit breaker activation
      if (state.risk.circuit_breakers) {
        for (const [key, active] of Object.entries(state.risk.circuit_breakers)) {
          if (active) {
            this.emit('circuit_breaker', { instance: name, breaker: key });
          }
        }
      }

      this.previousRegimes.set(name, state.regime.label);
      this.instances.set(name, state);
    } catch {
      this.emit('instance_error', { instance: name, error: 'Cannot read state.json' });
    }
  }

  getState(instance: string): InstanceState | undefined { return this.instances.get(instance); }
  getAllStates(): Map<string, InstanceState> { return this.instances; }
}
```

### src/trading/instance-control.ts

Subprocess wrapper for regime-trader's instance_manager.py.

```typescript
import { spawn, execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';

export class InstanceController {
  constructor(private basePath: string) {}

  // All methods call: python instance_manager.py <command> <args>
  // from the basePath directory

  async listInstances(): Promise<string> { /* exec instance_manager.py list */ }
  async startInstance(name: string, mode = 'paper'): Promise<string> { /* exec start */ }
  async stopInstance(name: string): Promise<string> { /* exec stop */ }
  async getStatus(): Promise<string> { /* exec status */ }

  async haltInstance(name: string): Promise<void> {
    const lockPath = path.join(this.basePath, 'instances', name, 'trading_halted.lock');
    await writeFile(lockPath, `Halted via Telegram at ${new Date().toISOString()}`);
  }

  async resumeInstance(name: string): Promise<void> {
    const lockPath = path.join(this.basePath, 'instances', name, 'trading_halted.lock');
    await unlink(lockPath);
  }

  async runBacktest(name: string): Promise<string> {
    // Spawn: python main.py --backtest --instance <name>
    // Capture stdout, return when complete
  }
}
```

Use `execFile` with `{ cwd: this.basePath }` and the Python executable. On Windows, use the venv Python: `path.join(this.basePath, '.venv', 'Scripts', 'python.exe')`.

### src/trading/alerts.ts

Rate-limited alert manager that sends Telegram messages on trading events.

```typescript
export class TradingAlertManager {
  private lastAlerts = new Map<string, number>(); // key → timestamp
  private throttleMs = 15 * 60 * 1000; // 15 min per alert type per instance
  private enabled = true;

  constructor(private sender: (text: string) => Promise<void>) {}

  toggle(on: boolean): void { this.enabled = on; }

  async send(alert: TradingAlert): Promise<boolean> {
    if (!this.enabled) return false;
    const key = `${alert.type}:${alert.instance}`;
    const last = this.lastAlerts.get(key);
    if (last && Date.now() - last < this.throttleMs) return false;

    this.lastAlerts.set(key, Date.now());
    await this.sender(this.formatAlert(alert));
    return true;
  }

  private formatAlert(alert: TradingAlert): string {
    // Format as clean Telegram text (no heavy markdown)
    // e.g., "REGIME CHANGE [spy-aggressive]: WEAK_BULL → CRASH (conf: 0.87)"
  }
}
```

### src/trading/telegram-commands.ts

Register `/trade` commands in the bot. Export a function that takes the bot instance and wires up handlers.

```typescript
export function registerTradingCommands(
  bot: Bot,
  poller: StatePoller,
  controller: InstanceController,
  alertManager: TradingAlertManager,
): void {
  // /trade status -- show all instances with regime, equity, P&L
  // /trade regime -- current regime details with confidence and stability
  // /trade halt [instance] -- write lock file
  // /trade resume [instance] -- remove lock file
  // /trade start <instance> [--mode paper] -- start instance
  // /trade stop <instance> -- stop instance
  // /trade backtest <instance> -- trigger backtest, send results when done
  // /trade pnl -- daily/weekly/total P&L
  // /trade alerts on|off -- toggle proactive alerts
}
```

Handle the `/trade` prefix by parsing the subcommand from the message text. Use the bot's `on('message:text')` handler with a `/trade` prefix check.

### src/trading/index.ts

Initialize and export all trading modules.

```typescript
import { StatePoller } from './state-poller.js';
import { InstanceController } from './instance-control.js';
import { TradingAlertManager } from './alerts.js';

export function initTrading(
  sender: (text: string) => Promise<void>,
  regimeTraderPath: string,
  instanceNames: string[],
): { poller: StatePoller; controller: InstanceController; alertManager: TradingAlertManager } {
  const poller = new StatePoller(regimeTraderPath, instanceNames);
  const controller = new InstanceController(regimeTraderPath);
  const alertManager = new TradingAlertManager(sender);

  // Wire up poller events to alerts
  poller.on('regime_change', (data) => {
    void alertManager.send({
      type: 'regime_change',
      instance: data.instance,
      message: `Regime: ${data.from} → ${data.to}`,
      timestamp: Date.now(),
    });
  });

  poller.on('circuit_breaker', (data) => {
    void alertManager.send({
      type: 'circuit_breaker',
      instance: data.instance,
      message: `Circuit breaker ACTIVE: ${data.breaker}`,
      timestamp: Date.now(),
    });
  });

  poller.start();
  return { poller, controller, alertManager };
}
```

### Wire into main bot

In src/index.ts, after the scheduler init:

```typescript
import { initTrading } from './trading/index.js';
import { registerTradingCommands } from './trading/telegram-commands.js';

// After initScheduler():
const regimeTraderPath = process.env.REGIME_TRADER_PATH || 'C:\\Projects\\regime-trader';
const instanceNames = (process.env.REGIME_TRADER_INSTANCES || 'spy-aggressive,spy-conservative').split(',');

if (AGENT_ID === 'main') {
  const { poller, controller, alertManager } = initTrading(telegramSender, regimeTraderPath, instanceNames);
  registerTradingCommands(bot, poller, controller, alertManager);
  logger.info({ instances: instanceNames }, 'Trading integration active');
}
```

Add to .env.example:
```
REGIME_TRADER_PATH=C:\Projects\regime-trader
REGIME_TRADER_INSTANCES=spy-aggressive,spy-conservative
```

### STOP CONDITION 2

```bash
npm run typecheck   # Zero errors including new src/trading/ files
npm run build       # Clean compilation
npm test            # All tests pass
```

Verify:
- src/trading/ directory exists with 6 files
- All imports resolve correctly
- StatePoller reads a real state.json from regime-trader if available
- .env.example has the new vars

DO NOT proceed to Phase 3 until all pass.

---

## PHASE 3: Headless Operation + Health Check

### Health endpoint

Add to src/dashboard.ts:

```typescript
app.get('/health', (c) => {
  const dbOk = checkDatabaseHealth();
  const botOk = getTelegramConnected();
  return c.json({
    status: dbOk && botOk ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    database: dbOk ? 'ok' : 'error',
    telegram: botOk ? 'connected' : 'disconnected',
    agent: AGENT_ID,
  }, dbOk && botOk ? 200 : 503);
});
```

Add to src/db.ts:
```typescript
export function checkDatabaseHealth(): boolean {
  try {
    const result = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
    return result.quick_check === 'ok';
  } catch { return false; }
}
```

### Headless startup scripts

Create scripts/start-headless.sh:
```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/.."
npm run build
mkdir -p logs
npx pm2 start ecosystem.config.cjs
npx pm2 save
echo "ClaudeClaw running headlessly."
```

Create scripts/start-headless.ps1:
```powershell
Set-Location $PSScriptRoot\..
npm run build
New-Item -ItemType Directory -Force -Path logs | Out-Null
npx pm2 start ecosystem.config.cjs
npx pm2 save
Write-Host "ClaudeClaw running headlessly."
```

### STOP CONDITION 3 (FINAL)

```bash
npm run typecheck
npm run build
npm test
```

Additionally:
- Verify /health endpoint responds (start bot briefly, curl localhost:3141/health)
- Verify ecosystem.config.cjs is valid (node -e "require('./ecosystem.config.cjs')")
- Verify scripts are executable

---

## FORBIDDEN ACTIONS

- NEVER rebuild trading logic in TypeScript. regime-trader handles all trading decisions.
- NEVER store API keys in source code.
- NEVER auto-commit without user request.
- NEVER skip typecheck/build between phases.
- NEVER proceed past a STOP CONDITION without all checks passing.
- NEVER remove existing ClaudeClaw functionality.
- NEVER modify regime-trader project files.
- NEVER delete existing test files.

## CHECKPOINT OUTPUT

After each phase, report:
1. Files created/modified (with line counts)
2. Build status (typecheck + build)
3. Test status
4. What was verified and how
5. Issues encountered and resolved

After all 3 phases, provide:
- Total files changed
- All stop conditions verified
- Instructions for first headless launch
- The exact commands to start both regime-trader and ClaudeClaw together
```

---

**Setup note:** Before running, add `REGIME_TRADER_PATH=C:\Projects\regime-trader` and `REGIME_TRADER_INSTANCES=spy-aggressive,spy-conservative` to your .env file.
