# Calibration Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether the LLM-predicted probabilities in `poly_signals.estimated_prob` are well-calibrated against actual `poly_paper_trades` resolutions, persist daily snapshots, surface via `/poly calibration`, and alert when the rolling Brier score exceeds a configurable threshold.

**Architecture:** Pure functions for the math (Brier, log loss, calibration curve) — no I/O, fully unit-testable. Thin DB layer to pull resolved samples and persist snapshots. Daily cron in `initPoly` (piggybacked on existing 5-minute digest tick, gated by a `poly_kv` last-run-ymd stamp). New `/poly calibration` subcommand calls a renderer over the latest snapshot.

**Tech Stack:** TypeScript, better-sqlite3, vitest, existing grammy command surface, existing pino logger, no new npm dependencies.

**Operator sign-off required before any code is written.**

---

## File Map

**Create:**
- `migrations/v1.3.0/v1.3.0-calibration.ts` — schema for `poly_calibration_snapshots`
- `migrations/v1.3.0/` directory
- `src/poly/calibration.ts` — pure math + DB layer + composer + alert helper
- `src/poly/calibration.test.ts` — unit tests (TDD)

**Modify:**
- `migrations/version.json` — register `v1.3.0`
- `src/config.ts` — add `POLY_CALIBRATION_HOUR`, `POLY_CALIBRATION_BRIER_ALERT`, `POLY_CALIBRATION_LOOKBACK_DAYS` (declare in `envSchema` keys + export at bottom)
- `src/poly/index.ts` — wire daily calibration tick + alert into the existing 5-minute interval, expose latest snapshot to render path
- `src/poly/telegram-commands.ts` — add `case 'calibration'`, append `/poly calibration` to HELP, add `renderCalibration()`
- `src/poly/telegram-commands.test.ts` — render tests against in-memory DB

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS poly_calibration_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    INTEGER NOT NULL,         -- unix sec when snapshot computed
  window_start  INTEGER NOT NULL,         -- unix sec — earliest resolved_at used
  window_end    INTEGER NOT NULL,         -- unix sec — latest resolved_at used
  n_samples     INTEGER NOT NULL,         -- count of (won + lost) trades; voided excluded
  brier_score   REAL,                     -- nullable when n_samples = 0
  log_loss      REAL,                     -- nullable when n_samples = 0
  win_rate      REAL,                     -- fraction of n_samples that resolved 'won'
  curve_json    TEXT NOT NULL             -- JSON: [{bucket,predLow,predHigh,count,actualWinRate}, ...]
);
CREATE INDEX IF NOT EXISTS idx_poly_calibration_created ON poly_calibration_snapshots(created_at DESC);
```

---

## Sign-Off Checkpoint

**STOP HERE on first run. Do not execute any task below until the operator approves the plan above.** Operator's approval is recorded by replying "approved" or by checking a box below.

- [ ] Operator approved plan on YYYY-MM-DD

---

## Task 0: Branch + Dependency Check

**Files:** none modified yet

- [ ] **Step 1: Verify clean working tree**

Run:
```bash
cd "C:/Users/Richard/OneDrive - Greystar/Documents/Code Projects/CCBot1080/claudeclaw"
rtk git status --short
```

Expected: empty output. If not empty, stash or commit before continuing.

- [ ] **Step 2: Branch from main**

```bash
rtk git checkout -b feat/calibration-tracker
```

- [ ] **Step 3: Verify no new deps required**

We use only `better-sqlite3` (existing), built-in `Math`, `JSON`. No `npm install` step.

---

## Task 1: Migration v1.3.0

**Files:**
- Create: `migrations/v1.3.0/v1.3.0-calibration.ts`
- Modify: `migrations/version.json`
- Test: extend `src/poly/migration.test.ts` (existing) OR create `src/poly/calibration-migration.test.ts`

- [ ] **Step 1: Create migration directory**

```bash
mkdir -p migrations/v1.3.0
```

- [ ] **Step 2: Write the failing migration test** (new file)

`src/poly/calibration-migration.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { runAt } from '../../migrations/v1.3.0/v1.3.0-calibration.js';

describe('v1.3.0 calibration migration', () => {
  it('creates poly_calibration_snapshots with the expected columns and index', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-cal-mig-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    const db = new Database(tmp, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info(poly_calibration_snapshots)`).all() as Array<{ name: string; type: string; notnull: number }>;
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual([
      'brier_score', 'created_at', 'curve_json', 'id',
      'log_loss', 'n_samples', 'win_rate', 'window_end', 'window_start',
    ]);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='poly_calibration_snapshots'`).all() as Array<{ name: string }>;
    expect(idx.map(i => i.name)).toContain('idx_poly_calibration_created');
    db.close();
    fs.unlinkSync(tmp);
  });

  it('is idempotent (CREATE IF NOT EXISTS)', async () => {
    const tmp = path.join(os.tmpdir(), `ccclaw-cal-mig-idem-${Date.now()}.db`);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await runAt(tmp);
    await runAt(tmp);  // second run must not throw
    const db = new Database(tmp, { readonly: true });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM poly_calibration_snapshots`).get()).toEqual({ n: 0 });
    db.close();
    fs.unlinkSync(tmp);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
rtk npm test -- --run src/poly/calibration-migration
```

Expected: FAIL with "Cannot find module '../../migrations/v1.3.0/v1.3.0-calibration.js'".

- [ ] **Step 4: Write the migration**

`migrations/v1.3.0/v1.3.0-calibration.ts`:
```ts
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description = 'Add poly_calibration_snapshots for Sprint 1 (calibration tracker)';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_calibration_snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    INTEGER NOT NULL,
        window_start  INTEGER NOT NULL,
        window_end    INTEGER NOT NULL,
        n_samples     INTEGER NOT NULL,
        brier_score   REAL,
        log_loss      REAL,
        win_rate      REAL,
        curve_json    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_poly_calibration_created
        ON poly_calibration_snapshots(created_at DESC);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
rtk npm test -- --run src/poly/calibration-migration
```

Expected: PASS (2 tests).

- [ ] **Step 6: Register in version.json**

Modify `migrations/version.json`:
```json
{
  "migrations": {
    "v1.2.0": ["v1.2.0-poly"],
    "v1.3.0": ["v1.3.0-calibration"]
  }
}
```

- [ ] **Step 7: Apply migration locally**

```bash
rtk npm run migrate
```

Expected: confirms v1.3.0-calibration applied (interactive prompt — type `y`).

- [ ] **Step 8: Verify**

```bash
sqlite3 "C:/claudeclaw-store/claudeclaw.db" ".schema poly_calibration_snapshots" 2>/dev/null \
  || npx tsx -e "import('better-sqlite3').then(m=>{const d=new m.default('C:/claudeclaw-store/claudeclaw.db',{readonly:true});console.log(d.prepare(\"SELECT sql FROM sqlite_master WHERE name='poly_calibration_snapshots'\").get())});"
```

Expected: schema matches.

- [ ] **Step 9: Commit**

```bash
rtk git add migrations/v1.3.0/v1.3.0-calibration.ts migrations/version.json src/poly/calibration-migration.test.ts
rtk git commit -m "feat(poly): v1.3.0 migration — poly_calibration_snapshots table"
```

---

## Task 2: Pure math — Brier score

**Files:**
- Create: `src/poly/calibration.ts`
- Test: `src/poly/calibration.test.ts`

- [ ] **Step 1: Write failing tests for `brierScore`**

`src/poly/calibration.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { brierScore, type ResolvedSample } from './calibration.js';

describe('brierScore', () => {
  it('returns null on empty input (cannot measure)', () => {
    expect(brierScore([])).toBeNull();
  });

  it('returns 0 when every prediction equals the outcome (perfect calibration)', () => {
    const samples: ResolvedSample[] = [
      { estimatedProb: 1, outcome: 1 },
      { estimatedProb: 0, outcome: 0 },
    ];
    expect(brierScore(samples)).toBeCloseTo(0, 10);
  });

  it('returns 1 when every prediction is maximally wrong', () => {
    const samples: ResolvedSample[] = [
      { estimatedProb: 0, outcome: 1 },
      { estimatedProb: 1, outcome: 0 },
    ];
    expect(brierScore(samples)).toBeCloseTo(1, 10);
  });

  it('returns 0.25 for uniform 50% predictions on mixed outcomes (random-guess baseline)', () => {
    const samples: ResolvedSample[] = [
      { estimatedProb: 0.5, outcome: 1 },
      { estimatedProb: 0.5, outcome: 0 },
    ];
    expect(brierScore(samples)).toBeCloseTo(0.25, 10);
  });

  it('matches manual calculation on a mixed three-sample case', () => {
    // (0.7-1)^2 + (0.4-0)^2 + (0.9-1)^2 = 0.09 + 0.16 + 0.01 = 0.26 / 3 ≈ 0.0867
    const samples: ResolvedSample[] = [
      { estimatedProb: 0.7, outcome: 1 },
      { estimatedProb: 0.4, outcome: 0 },
      { estimatedProb: 0.9, outcome: 1 },
    ];
    expect(brierScore(samples)).toBeCloseTo(0.0866666666, 6);
  });
});
```

- [ ] **Step 2: Run tests (verify failing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: FAIL — "Cannot find module './calibration.js'".

- [ ] **Step 3: Write minimal `calibration.ts` to pass**

`src/poly/calibration.ts`:
```ts
export interface ResolvedSample {
  estimatedProb: number;
  outcome: 0 | 1;
}

export function brierScore(samples: ResolvedSample[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const diff = s.estimatedProb - s.outcome;
    sum += diff * diff;
  }
  return sum / samples.length;
}
```

- [ ] **Step 4: Run tests (verify passing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add src/poly/calibration.ts src/poly/calibration.test.ts
rtk git commit -m "feat(poly): brierScore pure function with TDD"
```

---

## Task 3: Pure math — Log loss

**Files:** modify `src/poly/calibration.ts`, `src/poly/calibration.test.ts`

- [ ] **Step 1: Append failing tests for `logLoss`**

Append to `src/poly/calibration.test.ts`:
```ts
import { logLoss } from './calibration.js';

describe('logLoss', () => {
  it('returns null on empty input', () => {
    expect(logLoss([])).toBeNull();
  });

  it('returns ~0 for confidently correct predictions', () => {
    const samples: ResolvedSample[] = [
      { estimatedProb: 0.999, outcome: 1 },
      { estimatedProb: 0.001, outcome: 0 },
    ];
    const ll = logLoss(samples);
    expect(ll).not.toBeNull();
    expect(ll!).toBeLessThan(0.01);
  });

  it('caps at log(EPS) to avoid -Infinity when prediction is 0 for a winning outcome', () => {
    const samples: ResolvedSample[] = [{ estimatedProb: 0, outcome: 1 }];
    const ll = logLoss(samples)!;
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(30);  // -log(1e-15) ≈ 34.5
  });

  it('caps when prediction is 1 for a losing outcome', () => {
    const samples: ResolvedSample[] = [{ estimatedProb: 1, outcome: 0 }];
    const ll = logLoss(samples)!;
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(30);
  });

  it('returns ln(2) ≈ 0.6931 for uniform 50% on mixed outcomes', () => {
    const samples: ResolvedSample[] = [
      { estimatedProb: 0.5, outcome: 1 },
      { estimatedProb: 0.5, outcome: 0 },
    ];
    expect(logLoss(samples)).toBeCloseTo(Math.LN2, 6);
  });
});
```

- [ ] **Step 2: Run tests (verify failing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: FAIL — `logLoss is not a function`.

- [ ] **Step 3: Implement `logLoss`**

Append to `src/poly/calibration.ts`:
```ts
const LOG_LOSS_EPS = 1e-15;

export function logLoss(samples: ResolvedSample[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const p = Math.min(Math.max(s.estimatedProb, LOG_LOSS_EPS), 1 - LOG_LOSS_EPS);
    sum += -(s.outcome * Math.log(p) + (1 - s.outcome) * Math.log(1 - p));
  }
  return sum / samples.length;
}
```

- [ ] **Step 4: Run tests (verify passing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
rtk git add src/poly/calibration.ts src/poly/calibration.test.ts
rtk git commit -m "feat(poly): logLoss with EPS clamping to avoid -Infinity"
```

---

## Task 4: Pure math — Calibration curve

**Files:** modify `src/poly/calibration.ts`, `src/poly/calibration.test.ts`

- [ ] **Step 1: Append failing tests for `calibrationCurve`**

Append to `src/poly/calibration.test.ts`:
```ts
import { calibrationCurve, type CurveBucket } from './calibration.js';

describe('calibrationCurve', () => {
  it('returns 10 buckets always, regardless of input size', () => {
    expect(calibrationCurve([])).toHaveLength(10);
    expect(calibrationCurve([{ estimatedProb: 0.5, outcome: 1 }])).toHaveLength(10);
  });

  it('bucket boundaries are [0,0.1), [0.1,0.2), ..., [0.9,1.0]', () => {
    const c = calibrationCurve([]);
    expect(c[0]!.predLow).toBe(0);
    expect(c[0]!.predHigh).toBeCloseTo(0.1, 10);
    expect(c[9]!.predLow).toBeCloseTo(0.9, 10);
    expect(c[9]!.predHigh).toBe(1);
  });

  it('places probability=1 in the last bucket (inclusive upper bound)', () => {
    const c = calibrationCurve([{ estimatedProb: 1, outcome: 1 }]);
    expect(c[9]!.count).toBe(1);
    expect(c[9]!.actualWinRate).toBe(1);
  });

  it('places probability=0.5 in bucket index 5 (band [0.5,0.6))', () => {
    const c = calibrationCurve([{ estimatedProb: 0.5, outcome: 0 }]);
    expect(c[5]!.count).toBe(1);
    expect(c[5]!.actualWinRate).toBe(0);
  });

  it('reports actualWinRate = null for empty buckets', () => {
    const c = calibrationCurve([{ estimatedProb: 0.5, outcome: 1 }]);
    expect(c[0]!.actualWinRate).toBeNull();
    expect(c[5]!.actualWinRate).toBe(1);
  });

  it('aggregates win rate per bucket correctly', () => {
    const c = calibrationCurve([
      { estimatedProb: 0.81, outcome: 1 },
      { estimatedProb: 0.85, outcome: 1 },
      { estimatedProb: 0.89, outcome: 0 },  // bucket 8: 2 wins / 3 = 0.6667
    ]);
    expect(c[8]!.count).toBe(3);
    expect(c[8]!.actualWinRate).toBeCloseTo(2 / 3, 6);
  });
});
```

- [ ] **Step 2: Run tests (verify failing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: FAIL — `calibrationCurve is not a function`.

- [ ] **Step 3: Implement `calibrationCurve`**

Append to `src/poly/calibration.ts`:
```ts
export interface CurveBucket {
  bucket: number;       // 0..9
  predLow: number;
  predHigh: number;
  count: number;
  actualWinRate: number | null;
}

export function calibrationCurve(samples: ResolvedSample[]): CurveBucket[] {
  const wins = new Array<number>(10).fill(0);
  const counts = new Array<number>(10).fill(0);
  for (const s of samples) {
    const p = Math.min(Math.max(s.estimatedProb, 0), 1);
    // probability=1 must land in bucket 9, not "bucket 10" (which doesn't exist).
    const idx = p === 1 ? 9 : Math.floor(p * 10);
    counts[idx]!++;
    if (s.outcome === 1) wins[idx]!++;
  }
  return Array.from({ length: 10 }, (_, i): CurveBucket => ({
    bucket: i,
    predLow: i / 10,
    predHigh: (i + 1) / 10,
    count: counts[i]!,
    actualWinRate: counts[i]! === 0 ? null : wins[i]! / counts[i]!,
  }));
}
```

- [ ] **Step 4: Run tests (verify passing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: PASS (16 tests total).

- [ ] **Step 5: Commit**

```bash
rtk git add src/poly/calibration.ts src/poly/calibration.test.ts
rtk git commit -m "feat(poly): calibrationCurve 10-bucket aggregator"
```

---

## Task 5: DB layer — fetchResolvedSamples

**Files:** modify `src/poly/calibration.ts`, `src/poly/calibration.test.ts`

- [ ] **Step 1: Append failing test using in-memory DB**

Append to `src/poly/calibration.test.ts`:
```ts
import Database from 'better-sqlite3';
import { fetchResolvedSamples } from './calibration.js';

function bootDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE poly_signals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, market_price REAL, estimated_prob REAL, edge_pct REAL,
      confidence TEXT, reasoning TEXT, contrarian TEXT, approved INTEGER NOT NULL,
      rejection_reasons TEXT, paper_trade_id INTEGER);
    CREATE TABLE poly_paper_trades (id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL, market_slug TEXT, outcome_token_id TEXT,
      outcome_label TEXT, side TEXT, entry_price REAL, size_usd REAL, shares REAL,
      kelly_fraction REAL, strategy TEXT, status TEXT,
      resolved_at INTEGER, realized_pnl REAL, voided_reason TEXT);
  `);
  return db;
}

function insertResolved(db: Database.Database, o: { prob: number; status: 'won'|'lost'|'voided'; resolvedAt: number; }): void {
  const sig = db.prepare(`INSERT INTO poly_signals (created_at,market_slug,outcome_token_id,outcome_label,market_price,estimated_prob,edge_pct,confidence,reasoning,approved) VALUES (0,'s','tok','Yes',0.4,?,10,'high','r',1)`).run(o.prob);
  const tradeId = sig.lastInsertRowid;
  db.prepare(`INSERT INTO poly_paper_trades (id,created_at,market_slug,outcome_token_id,outcome_label,side,entry_price,size_usd,shares,kelly_fraction,strategy,status,resolved_at,realized_pnl) VALUES (?,0,'s','tok','Yes','BUY',0.4,50,125,0.25,'ai',?,?,0)`).run(tradeId, o.status, o.resolvedAt);
  db.prepare(`UPDATE poly_signals SET paper_trade_id=? WHERE id=?`).run(tradeId, tradeId);
}

describe('fetchResolvedSamples', () => {
  it('returns empty when no resolved trades exist in window', () => {
    const db = bootDb();
    expect(fetchResolvedSamples(db, 0, 1000)).toEqual([]);
  });

  it('returns one ResolvedSample per won/lost trade within [start,end]', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.7, status: 'won',  resolvedAt: 100 });
    insertResolved(db, { prob: 0.3, status: 'lost', resolvedAt: 200 });
    const out = fetchResolvedSamples(db, 0, 1000);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ estimatedProb: 0.7, outcome: 1 });
    expect(out).toContainEqual({ estimatedProb: 0.3, outcome: 0 });
  });

  it('excludes voided trades (no information about probability calibration)', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.5, status: 'voided', resolvedAt: 100 });
    expect(fetchResolvedSamples(db, 0, 1000)).toEqual([]);
  });

  it('respects the time window inclusive on both ends', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.6, status: 'won', resolvedAt: 50 });
    insertResolved(db, { prob: 0.6, status: 'won', resolvedAt: 100 });
    insertResolved(db, { prob: 0.6, status: 'won', resolvedAt: 150 });
    expect(fetchResolvedSamples(db, 100, 100)).toHaveLength(1);
    expect(fetchResolvedSamples(db, 50, 150)).toHaveLength(3);
  });

  it('skips trades whose signal row was deleted (LEFT JOIN safety)', () => {
    const db = bootDb();
    insertResolved(db, { prob: 0.7, status: 'won', resolvedAt: 100 });
    db.prepare(`DELETE FROM poly_signals`).run();
    expect(fetchResolvedSamples(db, 0, 1000)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests (verify failing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: FAIL — `fetchResolvedSamples is not a function`.

- [ ] **Step 3: Implement `fetchResolvedSamples`**

Append to `src/poly/calibration.ts`:
```ts
import type Database from 'better-sqlite3';

interface RawRow { estimated_prob: number; status: string; }

export function fetchResolvedSamples(
  db: Database.Database,
  windowStartSec: number,
  windowEndSec: number,
): ResolvedSample[] {
  const rows = db.prepare(`
    SELECT s.estimated_prob, t.status
      FROM poly_paper_trades t
      INNER JOIN poly_signals s ON s.paper_trade_id = t.id
     WHERE t.status IN ('won','lost')
       AND t.resolved_at IS NOT NULL
       AND t.resolved_at >= ?
       AND t.resolved_at <= ?
  `).all(windowStartSec, windowEndSec) as RawRow[];
  return rows.map(r => ({
    estimatedProb: r.estimated_prob,
    outcome: r.status === 'won' ? 1 : 0,
  }));
}
```

- [ ] **Step 4: Run tests (verify passing)**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: PASS (21 tests total).

- [ ] **Step 5: Commit**

```bash
rtk git add src/poly/calibration.ts src/poly/calibration.test.ts
rtk git commit -m "feat(poly): fetchResolvedSamples — INNER JOIN signals × trades"
```

---

## Task 6: Snapshot composer + persist + latest

**Files:** modify `src/poly/calibration.ts`, `src/poly/calibration.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/poly/calibration.test.ts`:
```ts
import { composeSnapshot, persistSnapshot, latestSnapshot, type CalibrationSnapshot } from './calibration.js';

function bootCalDb(): Database.Database {
  const db = bootDb();
  db.exec(`
    CREATE TABLE poly_calibration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
      n_samples INTEGER NOT NULL, brier_score REAL, log_loss REAL, win_rate REAL,
      curve_json TEXT NOT NULL);
  `);
  return db;
}

describe('composeSnapshot', () => {
  it('returns null when no resolved samples exist in lookback', () => {
    const db = bootCalDb();
    expect(composeSnapshot(db, 1_700_000_000_000, 30)).toBeNull();
  });

  it('returns a snapshot with brier/logLoss/winRate/curve when samples exist', () => {
    const db = bootCalDb();
    const now = 1_700_000_000;
    insertResolved(db, { prob: 0.7, status: 'won',  resolvedAt: now - 86400 });
    insertResolved(db, { prob: 0.3, status: 'lost', resolvedAt: now - 86400 });
    const snap = composeSnapshot(db, now * 1000, 30)!;
    expect(snap.nSamples).toBe(2);
    expect(snap.brierScore).toBeCloseTo(((0.7 - 1) ** 2 + (0.3 - 0) ** 2) / 2, 6);
    expect(snap.winRate).toBeCloseTo(0.5, 6);
    expect(snap.curve).toHaveLength(10);
    expect(snap.windowEnd).toBe(now);
    expect(snap.windowStart).toBe(now - 30 * 86400);
  });
});

describe('persistSnapshot + latestSnapshot', () => {
  it('persistSnapshot returns id; latestSnapshot returns the newest row', () => {
    const db = bootCalDb();
    const snap: CalibrationSnapshot = {
      createdAt: 100, windowStart: 0, windowEnd: 100, nSamples: 1,
      brierScore: 0.1, logLoss: 0.2, winRate: 1,
      curve: [{ bucket: 0, predLow: 0, predHigh: 0.1, count: 0, actualWinRate: null }],
    };
    const id = persistSnapshot(db, snap);
    expect(id).toBeGreaterThan(0);
    const latest = latestSnapshot(db);
    expect(latest!.brierScore).toBe(0.1);
    expect(latest!.curve).toHaveLength(1);
  });

  it('latestSnapshot returns null when no rows exist', () => {
    const db = bootCalDb();
    expect(latestSnapshot(db)).toBeNull();
  });

  it('latestSnapshot returns the most recently created snapshot, not the highest id', () => {
    const db = bootCalDb();
    const base: CalibrationSnapshot = {
      createdAt: 0, windowStart: 0, windowEnd: 0, nSamples: 0,
      brierScore: null, logLoss: null, winRate: 0, curve: [],
    };
    persistSnapshot(db, { ...base, createdAt: 200, brierScore: 0.5 });
    persistSnapshot(db, { ...base, createdAt: 100, brierScore: 0.9 });
    expect(latestSnapshot(db)!.brierScore).toBe(0.5);
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: FAIL — `composeSnapshot is not a function`.

- [ ] **Step 3: Implement composer + persistence**

Append to `src/poly/calibration.ts`:
```ts
export interface CalibrationSnapshot {
  createdAt: number;       // unix sec
  windowStart: number;     // unix sec
  windowEnd: number;       // unix sec
  nSamples: number;
  brierScore: number | null;
  logLoss: number | null;
  winRate: number;
  curve: CurveBucket[];
}

export function composeSnapshot(
  db: Database.Database,
  nowMs: number,
  lookbackDays: number,
): CalibrationSnapshot | null {
  const nowSec = Math.floor(nowMs / 1000);
  const windowStart = nowSec - lookbackDays * 86400;
  const samples = fetchResolvedSamples(db, windowStart, nowSec);
  if (samples.length === 0) return null;
  const wins = samples.filter(s => s.outcome === 1).length;
  return {
    createdAt: nowSec,
    windowStart,
    windowEnd: nowSec,
    nSamples: samples.length,
    brierScore: brierScore(samples),
    logLoss: logLoss(samples),
    winRate: wins / samples.length,
    curve: calibrationCurve(samples),
  };
}

export function persistSnapshot(db: Database.Database, snap: CalibrationSnapshot): number {
  const info = db.prepare(`
    INSERT INTO poly_calibration_snapshots
      (created_at, window_start, window_end, n_samples, brier_score, log_loss, win_rate, curve_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snap.createdAt, snap.windowStart, snap.windowEnd, snap.nSamples,
    snap.brierScore, snap.logLoss, snap.winRate, JSON.stringify(snap.curve),
  );
  return Number(info.lastInsertRowid);
}

export function latestSnapshot(db: Database.Database): CalibrationSnapshot | null {
  const row = db.prepare(`
    SELECT created_at, window_start, window_end, n_samples,
           brier_score, log_loss, win_rate, curve_json
      FROM poly_calibration_snapshots
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `).get() as { created_at: number; window_start: number; window_end: number; n_samples: number;
                 brier_score: number | null; log_loss: number | null; win_rate: number; curve_json: string } | undefined;
  if (!row) return null;
  return {
    createdAt: row.created_at, windowStart: row.window_start, windowEnd: row.window_end,
    nSamples: row.n_samples, brierScore: row.brier_score, logLoss: row.log_loss,
    winRate: row.win_rate, curve: JSON.parse(row.curve_json) as CurveBucket[],
  };
}
```

- [ ] **Step 4: Verify passing**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: PASS (26 tests total).

- [ ] **Step 5: Commit**

```bash
rtk git add src/poly/calibration.ts src/poly/calibration.test.ts
rtk git commit -m "feat(poly): composeSnapshot + persistSnapshot + latestSnapshot"
```

---

## Task 7: Telegram render + /poly calibration command

**Files:** modify `src/poly/telegram-commands.ts`, `src/poly/telegram-commands.test.ts`

- [ ] **Step 1: Add failing render tests**

Append to `src/poly/telegram-commands.test.ts` (after the `renderPnl` block):
```ts
import { renderCalibration } from './telegram-commands.js';

describe('renderCalibration', () => {
  function bootCalDb(): Database.Database {
    const d = new Database(':memory:');
    d.exec(`CREATE TABLE poly_calibration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
      n_samples INTEGER NOT NULL, brier_score REAL, log_loss REAL, win_rate REAL,
      curve_json TEXT NOT NULL);`);
    return d;
  }

  it('shows empty-state message when no snapshot exists yet', () => {
    expect(renderCalibration(bootCalDb())).toMatch(/no calibration snapshot/i);
  });

  it('renders Brier, log loss, win rate and the populated curve buckets', () => {
    const db = bootCalDb();
    db.prepare(`INSERT INTO poly_calibration_snapshots (created_at,window_start,window_end,n_samples,brier_score,log_loss,win_rate,curve_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(now, now - 30 * 86400, now, 12, 0.18, 0.41, 7/12,
        JSON.stringify([
          { bucket: 0, predLow: 0,   predHigh: 0.1, count: 0, actualWinRate: null },
          { bucket: 5, predLow: 0.5, predHigh: 0.6, count: 4, actualWinRate: 0.5 },
          { bucket: 8, predLow: 0.8, predHigh: 0.9, count: 8, actualWinRate: 0.875 },
        ]));
    const txt = renderCalibration(db);
    expect(txt).toContain('Brier');
    expect(txt).toContain('0.180');
    expect(txt).toContain('Log loss');
    expect(txt).toContain('0.410');
    expect(txt).toContain('n=12');
    expect(txt).toContain('50-60%');
    expect(txt).toContain('80-90%');
    expect(txt).not.toContain('0-10%');  // empty bucket suppressed
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
rtk npm test -- --run src/poly/telegram-commands
```

Expected: FAIL — `renderCalibration is not a function`.

- [ ] **Step 3: Implement renderer + command wiring**

In `src/poly/telegram-commands.ts`:

- Add import at top: `import { latestSnapshot } from './calibration.js';`
- Add the new case after `case 'pnl':` in the switch:
```ts
        case 'calibration':
          return void await ctx.reply(truncateForTelegram(renderCalibration(db)).text);
```
- Append to `HELP`:
```
/poly calibration — Brier / log loss / curve over recent resolutions
```
- Append the renderer at the end of the file:
```ts
export function renderCalibration(db: Database.Database): string {
  const snap = latestSnapshot(db);
  if (!snap) return 'No calibration snapshot yet. Daily snapshot fires at POLY_CALIBRATION_HOUR.';
  const ageHrs = ((Math.floor(Date.now() / 1000)) - snap.createdAt) / 3600;
  const lines: string[] = [
    `Calibration (n=${snap.nSamples} resolved, last ${Math.round((snap.windowEnd - snap.windowStart) / 86400)}d)`,
    `Brier: ${snap.brierScore?.toFixed(3) ?? 'n/a'}  Log loss: ${snap.logLoss?.toFixed(3) ?? 'n/a'}  Win rate: ${(snap.winRate * 100).toFixed(0)}%`,
    `Snapshot age: ${ageHrs.toFixed(1)}h`,
    '',
    'Predicted → actual (populated buckets only):',
  ];
  for (const b of snap.curve) {
    if (b.count === 0) continue;
    const lo = (b.predLow * 100).toFixed(0);
    const hi = (b.predHigh * 100).toFixed(0);
    const actual = b.actualWinRate === null ? 'n/a' : `${(b.actualWinRate * 100).toFixed(0)}% won`;
    lines.push(`  ${lo}-${hi}%: n=${b.count} → ${actual}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Verify passing**

```bash
rtk npm test -- --run src/poly
```

Expected: PASS (full suite + 2 new = 124 tests). Adjust expectation up by exact new count.

- [ ] **Step 5: Commit**

```bash
rtk git add src/poly/telegram-commands.ts src/poly/telegram-commands.test.ts
rtk git commit -m "feat(poly): /poly calibration command + renderCalibration"
```

---

## Task 8: Daily cron + alert wiring

**Files:** modify `src/config.ts`, `src/poly/calibration.ts`, `src/poly/calibration.test.ts`, `src/poly/index.ts`

- [ ] **Step 1: Add config keys**

Modify `src/config.ts`:
- Add to the keys list (alphabetical or grouped near other POLY_):
```ts
  'POLY_CALIBRATION_HOUR',
  'POLY_CALIBRATION_BRIER_ALERT',
  'POLY_CALIBRATION_LOOKBACK_DAYS',
```
- Add exports near other `POLY_` exports:
```ts
export const POLY_CALIBRATION_HOUR = num('POLY_CALIBRATION_HOUR', 7);
export const POLY_CALIBRATION_BRIER_ALERT = num('POLY_CALIBRATION_BRIER_ALERT', 0.30);
export const POLY_CALIBRATION_LOOKBACK_DAYS = num('POLY_CALIBRATION_LOOKBACK_DAYS', 30);
```

- [ ] **Step 2: Add failing tests for `shouldRunCalibration` + `formatCalibrationAlert`**

Append to `src/poly/calibration.test.ts`:
```ts
import { shouldRunCalibration, formatCalibrationAlert, MIN_ALERT_SAMPLES } from './calibration.js';
import { DateTime } from 'luxon';

describe('shouldRunCalibration', () => {
  const tz = 'America/New_York';
  it('returns true at 07:xx local when lastRunYmd is yesterday', () => {
    const now = DateTime.fromISO('2026-04-13T07:05:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: '2026-04-12' })).toBe(true);
  });
  it('returns false before the configured hour', () => {
    const now = DateTime.fromISO('2026-04-13T06:59:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: '2026-04-12' })).toBe(false);
  });
  it('returns false when already ran today (lastRunYmd === today)', () => {
    const now = DateTime.fromISO('2026-04-13T08:00:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: '2026-04-13' })).toBe(false);
  });
  it('returns true when lastRunYmd is null (first ever run)', () => {
    const now = DateTime.fromISO('2026-04-13T08:00:00', { zone: tz }).toJSDate();
    expect(shouldRunCalibration({ hour: 7, timezone: tz, now, lastRunYmd: null })).toBe(true);
  });
});

describe('formatCalibrationAlert', () => {
  const baseSnap: CalibrationSnapshot = {
    createdAt: 0, windowStart: 0, windowEnd: 30 * 86400, nSamples: 12,
    brierScore: 0.40, logLoss: 0.85, winRate: 0.42, curve: [],
  };
  it('returns null when nSamples below MIN_ALERT_SAMPLES', () => {
    expect(formatCalibrationAlert({ ...baseSnap, nSamples: MIN_ALERT_SAMPLES - 1 }, 0.30)).toBeNull();
  });
  it('returns null when brierScore is null', () => {
    expect(formatCalibrationAlert({ ...baseSnap, brierScore: null }, 0.30)).toBeNull();
  });
  it('returns null when brierScore <= threshold', () => {
    expect(formatCalibrationAlert({ ...baseSnap, brierScore: 0.30 }, 0.30)).toBeNull();
    expect(formatCalibrationAlert({ ...baseSnap, brierScore: 0.20 }, 0.30)).toBeNull();
  });
  it('returns alert text when brierScore exceeds threshold and n >= MIN_ALERT_SAMPLES', () => {
    const txt = formatCalibrationAlert(baseSnap, 0.30);
    expect(txt).not.toBeNull();
    expect(txt!).toContain('Calibration alarm');
    expect(txt!).toContain('0.400');
    expect(txt!).toContain('0.300');
  });
});
```

- [ ] **Step 3: Verify failing**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: FAIL — `shouldRunCalibration is not a function`.

- [ ] **Step 4: Implement the helpers**

Append to `src/poly/calibration.ts`:
```ts
import { DateTime } from 'luxon';

export const MIN_ALERT_SAMPLES = 10;

export interface ShouldRunArgs {
  hour: number;
  timezone: string;
  now: Date;
  lastRunYmd: string | null;
}

export function shouldRunCalibration(a: ShouldRunArgs): boolean {
  const local = DateTime.fromJSDate(a.now).setZone(a.timezone);
  if (local.hour < a.hour) return false;
  const ymd = local.toFormat('yyyy-MM-dd');
  return a.lastRunYmd !== ymd;
}

export function todayYmd(now: Date, timezone: string): string {
  return DateTime.fromJSDate(now).setZone(timezone).toFormat('yyyy-MM-dd');
}

export function formatCalibrationAlert(snap: CalibrationSnapshot, threshold: number): string | null {
  if (snap.nSamples < MIN_ALERT_SAMPLES) return null;
  if (snap.brierScore === null) return null;
  if (snap.brierScore <= threshold) return null;
  return [
    `⚠️ Calibration alarm`,
    `Brier: ${snap.brierScore.toFixed(3)} > threshold ${threshold.toFixed(3)}`,
    `Log loss: ${snap.logLoss?.toFixed(3) ?? 'n/a'}  Win rate: ${(snap.winRate * 100).toFixed(0)}%`,
    `n=${snap.nSamples} resolved (last ${Math.round((snap.windowEnd - snap.windowStart) / 86400)}d)`,
    `Run /poly calibration for the curve.`,
  ].join('\n');
}
```

- [ ] **Step 5: Verify passing**

```bash
rtk npm test -- --run src/poly/calibration
```

Expected: PASS (~34 total).

- [ ] **Step 6: Wire the cron in initPoly**

Modify `src/poly/index.ts`:

- Add imports:
```ts
import {
  composeSnapshot, persistSnapshot, latestSnapshot,
  shouldRunCalibration, formatCalibrationAlert, todayYmd,
} from './calibration.js';
import {
  POLY_CALIBRATION_HOUR, POLY_CALIBRATION_BRIER_ALERT, POLY_CALIBRATION_LOOKBACK_DAYS,
} from '../config.js';
```

- Add to the existing 5-min `digestTimer` block (NOT a new interval — piggyback):

Inside the existing `setInterval(() => { try { … } catch … }, 5 * 60_000)`, after the digest block, add:
```ts
      // Daily calibration tick — gated by poly_kv last-run-ymd stamp.
      const lastCal = polyKvGet(opts.db, 'poly.last_calibration_ymd');
      if (
        shouldRunCalibration({
          hour: POLY_CALIBRATION_HOUR,
          timezone: POLY_TIMEZONE,
          now: new Date(),
          lastRunYmd: lastCal,
        })
      ) {
        const snap = composeSnapshot(opts.db, Date.now(), POLY_CALIBRATION_LOOKBACK_DAYS);
        const ymd = todayYmd(new Date(), POLY_TIMEZONE);
        if (snap !== null) {
          persistSnapshot(opts.db, snap);
          const alert = formatCalibrationAlert(snap, POLY_CALIBRATION_BRIER_ALERT);
          if (alert !== null) {
            opts
              .sender(alert)
              .catch(err => logger.warn({ err: String(err) }, 'calibration alert send failed'));
          }
        }
        // Stamp regardless — no resolved samples is still "we tried today".
        polyKvSet(opts.db, 'poly.last_calibration_ymd', ymd);
      }
```

- [ ] **Step 7: Verify typecheck + full suite**

```bash
rtk npm run typecheck && rtk npm test -- --run src/poly
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
rtk git add src/config.ts src/poly/calibration.ts src/poly/calibration.test.ts src/poly/index.ts
rtk git commit -m "feat(poly): daily calibration cron + Telegram alert (Sprint 1 done)"
```

---

## Task 9: Codex Review

- [ ] **Step 1: Run codex review against the branch**

Find the base commit (the one before Task 1's commit):
```bash
rtk git log --oneline -10
```

Then:
```bash
node "C:/Users/Richard/.claude/scripts/codex-review.js" --base <SHA-of-pre-task-1>
```

- [ ] **Step 2: Triage findings**

For each finding from codex:
- P1 + confidence ≥ 0.7 → apply fix in this branch + add regression test.
- P2 + confidence ≥ 0.7 → apply if low-risk; otherwise flag.
- P3 / cosmetic → skip with one-line rationale.

- [ ] **Step 3: Re-run typecheck + tests after any fixes**

```bash
rtk npm run typecheck && rtk npm test -- --run src/poly
```

- [ ] **Step 4: Commit codex fixes (if any)**

```bash
rtk git commit -am "fix(poly): codex review on calibration tracker"
```

---

## Task 10: Verification + ship

- [ ] **Step 1: Manual smoke**

```bash
npx tsx -e "
import('./src/poly/calibration.js').then(async m => {
  const D = (await import('better-sqlite3')).default;
  const db = new D('C:/claudeclaw-store/claudeclaw.db', { readonly: false });
  const snap = m.composeSnapshot(db, Date.now(), 30);
  console.log('Live snapshot from prod DB:', snap);
});
"
```

Expected: either `null` (no resolved trades yet) or a real snapshot with valid Brier. Either is fine.

- [ ] **Step 2: Build + restart pm2**

```bash
rtk npm run build && pm2 restart claudeclaw --update-env
```

- [ ] **Step 3: Verify bot picked it up**

```bash
sleep 10 && pm2 logs claudeclaw --lines 30 --nostream --raw 2>&1 | grep -vE "skipping malformed" | tail -15
```

Expected: `Polymarket module initialized (Phase C: scanner + strategy + pnl tracker)`. No errors.

- [ ] **Step 4: Test `/poly calibration` via Telegram**

Operator runs `/poly calibration` in chat. Expected: empty-state message until first daily snapshot fires (or until manual `composeSnapshot` happens).

- [ ] **Step 5: Merge to main**

```bash
rtk git checkout main && rtk git merge --ff-only feat/calibration-tracker && rtk git push
```

Then delete the feature branch:
```bash
rtk git branch -d feat/calibration-tracker
```

- [ ] **Step 6: Update operational docs**

Append a one-line entry to `docs/research/INDEX.md` (create if missing) noting Sprint 1 shipped, with calibration thresholds chosen and rationale.

- [ ] **Step 7: Update memory**

Add a memory entry capturing the calibration baseline thresholds chosen + first observed Brier, so Sprint 2 (strategy versioning) can reference it.

---

## Acceptance Criteria (operator review checklist)

- [ ] All 34+ unit tests pass; full poly suite ≥ 130 tests green.
- [ ] `tsc --noEmit` clean.
- [ ] Migration v1.3.0 applied; `poly_calibration_snapshots` exists in prod DB.
- [ ] `/poly calibration` returns formatted output without throwing.
- [ ] Daily cron is wired in `initPoly` — verified by code review.
- [ ] Codex review run; P0/P1 findings either applied or explicitly skipped with rationale.
- [ ] No new dependencies added.
- [ ] No changes to `risk-gates.ts`, `paper-broker.ts`, or `pnl-tracker.ts`.
- [ ] Bot running under pm2 with no restart loop after deploy.

---

## Risk Callouts

1. **Empty state at first** — until ≥ 10 trades resolve, alerts can't fire and the curve will be sparse. This is expected; the snapshot persists anyway so we have a 30-day history starting now.
2. **Voided trades excluded** — a market that delists tells us nothing about probability calibration. `fetchResolvedSamples` filters them out via `WHERE status IN ('won','lost')`. Documented in code comment.
3. **Bucket boundaries** — `prob = 1` lands in bucket 9 (the last), not "bucket 10". Tested explicitly.
4. **Log loss `-Infinity` guard** — `LOG_LOSS_EPS = 1e-15` clamps probabilities away from {0,1}. Tested explicitly for both directions.
5. **Concurrent cron** — gated by `poly_kv['poly.last_calibration_ymd']` so the 5-min interval can't double-fire on the same day. Same pattern as digest, which has been stable.
6. **No prompt_version yet** — Sprint 2 adds that column to `poly_signals`. Sprint 1 calibration is global across all prompt versions; that's fine for a baseline.

---

## Out of Scope (Sprint 2+ owns these)

- Per-prompt-version calibration breakdown.
- Per-regime calibration breakdown.
- Per-market-category breakdown (sports vs politics vs crypto).
- A/B comparison framework.
- Backtesting harness.

Each of those becomes its own plan when Sprint 1 is shipped and producing baseline data.
