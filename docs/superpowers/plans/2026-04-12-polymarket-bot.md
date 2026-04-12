# Polymarket Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase A (read-only Polymarket intel via Telegram) and Phase C (autonomous paper trading with Claude Opus 4.6 probability estimation and Kelly sizing) inside the existing ClaudeClaw bot.

**Architecture:** New in-process module `src/poly/` mirroring the boundaries of `src/trading/`. HTTP-only integration with Polymarket Gamma + CLOB APIs (no wallet, no CLI). Four recurring loops driven by `setInterval` (not the Claude-task scheduler): scanner (15m), evaluator (chained to scanner), P&L tracker (1h), digest (5m tick with daily guard). SQLite persistence via a new migration file. Single-writer discipline on `poly_paper_trades` transitions.

**Tech Stack:** TypeScript, grammy (Telegram), better-sqlite3, pino, Zod (NEW), `@anthropic-ai/sdk` (NEW — direct client for strategy calls, distinct from the existing `@anthropic-ai/claude-agent-sdk` used for chat), luxon (NEW — timezone-aware boundaries), vitest.

**Spec:** `docs/superpowers/specs/2026-04-12-polymarket-bot-design.md` — read before starting any task. All code must match its contracts.

**Full blueprint (reference only):** `docs/mega-prompt-polymarket-bot.md`

---

## Ground rules (read before starting)

- **TDD.** Every non-trivial module gets a colocated `*.test.ts` with vitest. Write the test first, watch it fail, implement, watch it pass. No implementation without a test run.
- **Commit after every task group.** Small commits, imperative subject, conventional prefix (`feat:`, `test:`, `refactor:`, `chore:`).
- **No `console.log`.** Use `logger` from `src/logger.ts`.
- **No `any`.** If a type is genuinely unknown (e.g. raw Gamma response), use `unknown` and narrow with Zod.
- **4096-char Telegram cap.** Every command output passes through a truncation helper before `ctx.reply`.
- **Single-writer discipline.** `paper-broker.ts` is the only writer that transitions `poly_paper_trades.status` to `open`; `pnl-tracker.ts` is the only writer for transitions to `won|lost|voided`.
- **Halt flag is checked at the start of every tick.** Scanner and P&L tracker ignore it; only evaluator and broker honor it.
- **No hardcoded secrets.** All config via env through `readEnvFile` in `src/config.ts`.

## Task map

| Task | What | Files | Phase |
|------|------|-------|-------|
| 0 | API-shape verification probe | `scripts/poly-probe.ts` | A |
| 1 | Add dependencies | `package.json` | A |
| 2 | Database migration | `migrations/v1.2.0-poly.ts`, `migrations/version.json` | A |
| 3 | Config + env | `src/config.ts` | A |
| 4 | Types + Zod schemas | `src/poly/types.ts` + test | A |
| 5 | Gamma client | `src/poly/gamma-client.ts` + test | A |
| 6 | CLOB client | `src/poly/clob-client.ts` + test | A |
| 7 | Market scanner + price history | `src/poly/market-scanner.ts` + test | A |
| 8 | Phase A Telegram commands | `src/poly/telegram-commands.ts` + test | A |
| 9 | Daily digest | `src/poly/digest.ts` + test | A |
| 10 | Wire Phase A into bot | `src/poly/index.ts`, `src/index.ts` | A |
| 11 | AI-probability strategy + eval cache | `src/poly/strategies/ai-probability.ts` + test | C |
| 12 | Risk gates | `src/poly/risk-gates.ts` + test | C |
| 13 | Paper broker | `src/poly/paper-broker.ts` + test | C |
| 14 | P&L tracker | `src/poly/pnl-tracker.ts` + test | C |
| 15 | Strategy engine (orchestrator) | `src/poly/strategy-engine.ts` + test | C |
| 16 | Alerts | `src/poly/alerts.ts` + test | C |
| 17 | Phase C commands | extend `telegram-commands.ts` | C |
| 18 | Wire Phase C into bot | extend `index.ts` | C |
| 19 | End-to-end manual QA | runbook in this doc | A+C |

---

## Task 0: API-shape verification probe

**Files:**
- Create: `scripts/poly-probe.ts`

The spec's field names are educated guesses. Before a single type is defined, run against the live API and dump the real JSON. Anything downstream that assumes a field name must trace back to this probe.

- [ ] **Step 1: Write the probe**

```typescript
// scripts/poly-probe.ts
// Hits Gamma + CLOB once, dumps raw JSON to data/poly-probe/. Throwaway.
import fs from 'fs/promises';
import path from 'path';

const OUT = path.resolve('data', 'poly-probe');

async function get(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true });

  const markets = await get('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=5');
  await fs.writeFile(path.join(OUT, 'markets.json'), JSON.stringify(markets, null, 2));

  const first = Array.isArray(markets) ? markets[0] : null;
  if (!first) throw new Error('No markets returned');

  const slug: string = first.slug ?? first.conditionId ?? 'unknown';
  const single = await get(`https://gamma-api.polymarket.com/markets/${slug}`);
  await fs.writeFile(path.join(OUT, 'market-single.json'), JSON.stringify(single, null, 2));

  // Try to extract a token id to probe CLOB. Shape TBD — this is the whole point.
  const tokenIds: string[] = first.clobTokenIds
    ? (typeof first.clobTokenIds === 'string' ? JSON.parse(first.clobTokenIds) : first.clobTokenIds)
    : [];
  if (tokenIds.length > 0) {
    const book = await get(`https://clob.polymarket.com/book?token_id=${tokenIds[0]}`);
    await fs.writeFile(path.join(OUT, 'book.json'), JSON.stringify(book, null, 2));
    const mid = await get(`https://clob.polymarket.com/midpoint?token_id=${tokenIds[0]}`);
    await fs.writeFile(path.join(OUT, 'midpoint.json'), JSON.stringify(mid, null, 2));
  }

  console.log('Probe complete. See', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the probe**

Run: `npx tsx scripts/poly-probe.ts`
Expected: `Probe complete. See ...poly-probe`, four JSON files written.

- [ ] **Step 3: Read each JSON, document the actual field names**

Open `data/poly-probe/markets.json` and note the real field names for: id, slug, question, outcomes, prices, volume, liquidity, end date, condition id, token ids. Write them as a comment at the top of `scripts/poly-probe.ts`. These names drive Task 4.

- [ ] **Step 4: Gitignore the probe output, commit the script**

```bash
echo "data/poly-probe/" >> .gitignore
git add scripts/poly-probe.ts .gitignore
git commit -m "chore(poly): add api-shape probe script"
```

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install new runtime deps**

```bash
npm install @anthropic-ai/sdk zod luxon
npm install -D @types/luxon
```

- [ ] **Step 2: Verify versions**

Run: `npm ls @anthropic-ai/sdk zod luxon`
Expected: three packages listed, no peer-dep warnings.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(poly): add zod, @anthropic-ai/sdk, luxon"
```

---

## Task 2: Database migration

**Files:**
- Create: `migrations/v1.2.0-poly.ts`
- Modify: `migrations/version.json`
- Test: `src/poly/migration.test.ts`

- [ ] **Step 1: Write the migration**

```typescript
// migrations/v1.2.0-poly.ts
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

export const description = 'Add poly_* tables for Polymarket bot (Phase A + C)';

export async function run(): Promise<void> {
  const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'));
  db.pragma('journal_mode = WAL');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_markets (
        slug TEXT PRIMARY KEY,
        condition_id TEXT NOT NULL,
        question TEXT NOT NULL,
        category TEXT,
        outcomes_json TEXT NOT NULL,
        volume_24h REAL NOT NULL DEFAULT 0,
        liquidity REAL NOT NULL DEFAULT 0,
        end_date INTEGER NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0,
        resolution TEXT,
        last_scan_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_poly_markets_volume ON poly_markets(volume_24h DESC);
      CREATE INDEX IF NOT EXISTS idx_poly_markets_end ON poly_markets(end_date);

      CREATE TABLE IF NOT EXISTS poly_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        market_price REAL NOT NULL,
        estimated_prob REAL NOT NULL,
        edge_pct REAL NOT NULL,
        confidence TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        contrarian TEXT,
        approved INTEGER NOT NULL,
        rejection_reasons TEXT,
        paper_trade_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_poly_signals_created ON poly_signals(created_at DESC);

      CREATE TABLE IF NOT EXISTS poly_paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        market_slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        outcome_label TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        size_usd REAL NOT NULL,
        shares REAL NOT NULL,
        kelly_fraction REAL NOT NULL,
        strategy TEXT NOT NULL,
        status TEXT NOT NULL,
        resolved_at INTEGER,
        realized_pnl REAL,
        voided_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_poly_paper_trades_status ON poly_paper_trades(status);

      CREATE TABLE IF NOT EXISTS poly_positions (
        paper_trade_id INTEGER PRIMARY KEY REFERENCES poly_paper_trades(id),
        market_slug TEXT NOT NULL,
        current_price REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poly_price_history (
        token_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        price REAL NOT NULL,
        PRIMARY KEY (token_id, captured_at)
      );

      CREATE TABLE IF NOT EXISTS poly_eval_cache (
        cache_key TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        outcome_token_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        probability REAL NOT NULL,
        confidence TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        contrarian TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_poly_eval_cache_created ON poly_eval_cache(created_at);
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

- [ ] **Step 2: Register the migration**

Edit `migrations/version.json`:

```json
{
  "migrations": {
    "v1.2.0": ["v1.2.0-poly.ts"]
  }
}
```

- [ ] **Step 3: Write an idempotency test**

```typescript
// src/poly/migration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { run } from '../../migrations/v1.2.0-poly.js';

describe('poly migration', () => {
  it('creates all 6 tables and is idempotent', async () => {
    await run();
    await run(); // second run must not throw
    // verify by opening the db and checking sqlite_master
    // (use STORE_DIR-aware path or mock config)
    expect(true).toBe(true); // placeholder — fill in with real table-existence assertions
  });
});
```

Note: depending on how `config.ts` resolves STORE_DIR in tests, you may need to run this test against a temp-dir-scoped DB. Prefer a thin wrapper that accepts a db path argument over mocking.

- [ ] **Step 4: Run the migration**

Run: `npm run migrate`
Expected: no errors, `migrations/.applied.json` now shows `"lastApplied": "v1.2.0"`.

- [ ] **Step 5: Verify tables exist**

Run: `sqlite3 store/claudeclaw.db ".tables" | grep poly_`
Expected: six `poly_*` tables listed.

- [ ] **Step 6: Commit**

```bash
git add migrations/ src/poly/migration.test.ts
git commit -m "feat(poly): add v1.2.0 migration for polymarket tables"
```

---

## Task 3: Config + env

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example` (if present; create if not)

- [ ] **Step 1: Add env keys to `readEnvFile` call**

Edit the array at the top of `src/config.ts` to include:

```typescript
'POLY_ENABLED',
'POLY_PAPER_CAPITAL',
'POLY_MAX_TRADE_USD',
'POLY_MAX_OPEN_POSITIONS',
'POLY_MAX_DEPLOYED_PCT',
'POLY_MIN_EDGE_PCT',
'POLY_MIN_TTR_HOURS',
'POLY_MIN_VOLUME_USD',
'POLY_DAILY_LOSS_PCT',
'POLY_HALT_DD_PCT',
'POLY_KELLY_FRACTION',
'POLY_MODEL',
'POLY_SCAN_INTERVAL_MIN',
'POLY_DIGEST_HOUR',
'POLY_TIMEZONE',
'ANTHROPIC_API_KEY',
```

- [ ] **Step 2: Export typed constants**

Append to `src/config.ts`:

```typescript
// ── Polymarket bot ───────────────────────────────────────────────────
function num(key: string, def: number): number {
  const v = process.env[key] ?? envConfig[key];
  const n = v === undefined || v === '' ? def : Number(v);
  return Number.isFinite(n) ? n : def;
}

export const POLY_ENABLED =
  (process.env.POLY_ENABLED || envConfig.POLY_ENABLED || 'false').toLowerCase() === 'true';
export const POLY_PAPER_CAPITAL = num('POLY_PAPER_CAPITAL', 5000);
export const POLY_MAX_TRADE_USD = num('POLY_MAX_TRADE_USD', 50);
export const POLY_MAX_OPEN_POSITIONS = num('POLY_MAX_OPEN_POSITIONS', 10);
export const POLY_MAX_DEPLOYED_PCT = num('POLY_MAX_DEPLOYED_PCT', 0.5);
export const POLY_MIN_EDGE_PCT = num('POLY_MIN_EDGE_PCT', 8);
export const POLY_MIN_TTR_HOURS = num('POLY_MIN_TTR_HOURS', 24);
export const POLY_MIN_VOLUME_USD = num('POLY_MIN_VOLUME_USD', 10000);
export const POLY_DAILY_LOSS_PCT = num('POLY_DAILY_LOSS_PCT', 0.05);
export const POLY_HALT_DD_PCT = num('POLY_HALT_DD_PCT', 0.2);
export const POLY_KELLY_FRACTION = num('POLY_KELLY_FRACTION', 0.25);
export const POLY_MODEL =
  process.env.POLY_MODEL || envConfig.POLY_MODEL || 'claude-opus-4-6';
export const POLY_SCAN_INTERVAL_MIN = num('POLY_SCAN_INTERVAL_MIN', 15);
export const POLY_DIGEST_HOUR = num('POLY_DIGEST_HOUR', 6);
export const POLY_TIMEZONE =
  process.env.POLY_TIMEZONE || envConfig.POLY_TIMEZONE || 'America/New_York';
export const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY || '';
```

- [ ] **Step 3: Add to `.env.example`**

Append the same keys with defaults (leave `ANTHROPIC_API_KEY=` blank).

- [ ] **Step 4: Verify build**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat(poly): add polymarket config keys"
```

---

## Task 4: Types + Zod schemas

**Files:**
- Create: `src/poly/types.ts`
- Test: `src/poly/types.test.ts`

The probe from Task 0 is authoritative for field names. Adjust the Zod schemas below if reality differs.

- [ ] **Step 1: Write the schema test first**

```typescript
// src/poly/types.test.ts
import { describe, it, expect } from 'vitest';
import { GammaMarketSchema, ClobBookSchema, SignalSchema } from './types.js';

describe('GammaMarketSchema', () => {
  it('parses a minimal valid market', () => {
    const raw = {
      conditionId: '0xabc',
      slug: 'will-x-happen',
      question: 'Will X happen?',
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 12345.6,
      liquidity: 999,
      endDate: '2026-12-31T23:59:59Z',
      closed: false,
    };
    const parsed = GammaMarketSchema.parse(raw);
    expect(parsed.slug).toBe('will-x-happen');
    expect(parsed.outcomes).toEqual(['Yes', 'No']);
    expect(parsed.outcomePrices).toEqual([0.42, 0.58]);
    expect(parsed.clobTokenIds).toEqual(['t1', 't2']);
  });

  it('rejects malformed outcomes json', () => {
    const raw = { /* … same as above but outcomes: 'not-json' */ };
    expect(() => GammaMarketSchema.parse(raw)).toThrow();
  });
});
```

- [ ] **Step 2: Run test → must fail**

Run: `npx vitest run src/poly/types.test.ts`
Expected: fails to import (module not found).

- [ ] **Step 3: Write the types**

```typescript
// src/poly/types.ts
import { z } from 'zod';

// Schemas accept the raw Polymarket shapes (field names per Task 0 probe).
// Helpers parse stringified JSON fields into typed arrays.

const stringArrayFromJson = z.string().transform((s, ctx) => {
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed) || !parsed.every(x => typeof x === 'string')) {
      ctx.addIssue({ code: 'custom', message: 'expected JSON string array' });
      return z.NEVER;
    }
    return parsed as string[];
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
    return z.NEVER;
  }
});

const numberArrayFromJson = z.string().transform((s, ctx) => {
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed)) { ctx.addIssue({ code: 'custom', message: 'expected array' }); return z.NEVER; }
    const nums = parsed.map(x => typeof x === 'string' ? Number(x) : x);
    if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) {
      ctx.addIssue({ code: 'custom', message: 'expected numeric array' });
      return z.NEVER;
    }
    return nums as number[];
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
    return z.NEVER;
  }
});

export const GammaMarketSchema = z.object({
  conditionId: z.string(),
  slug: z.string(),
  question: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  outcomes: stringArrayFromJson,
  outcomePrices: numberArrayFromJson,
  clobTokenIds: stringArrayFromJson,
  volume24hr: z.number().default(0),
  liquidity: z.number().default(0),
  endDate: z.string(),           // ISO
  closed: z.boolean().default(false),
}).passthrough();
export type GammaMarket = z.infer<typeof GammaMarketSchema>;

export const ClobBookLevelSchema = z.object({
  price: z.coerce.number(),
  size: z.coerce.number(),
});
export const ClobBookSchema = z.object({
  bids: z.array(ClobBookLevelSchema).default([]),
  asks: z.array(ClobBookLevelSchema).default([]),
}).passthrough();
export type ClobBook = z.infer<typeof ClobBookSchema>;

// Internal normalized shapes used by the rest of the module
export interface Market {
  slug: string;
  conditionId: string;
  question: string;
  category?: string;
  outcomes: Array<{ label: string; tokenId: string; price: number }>;
  volume24h: number;
  liquidity: number;
  endDate: number; // unix seconds
  closed: boolean;
}

export type Confidence = 'low' | 'medium' | 'high';

export const ProbabilityEstimateSchema = z.object({
  probability: z.number().min(0).max(1),
  confidence: z.enum(['low', 'medium', 'high']),
  reasoning: z.string().min(1),
  contrarian: z.string().optional(),
});
export type ProbabilityEstimate = z.infer<typeof ProbabilityEstimateSchema>;

export interface Signal {
  marketSlug: string;
  outcomeTokenId: string;
  outcomeLabel: string;
  marketPrice: number;          // ask at signal time
  estimatedProb: number;
  edgePct: number;
  confidence: Confidence;
  reasoning: string;
  contrarian?: string;
}

export const SignalSchema = z.custom<Signal>();

export interface PaperTrade {
  id: number;
  marketSlug: string;
  outcomeTokenId: string;
  outcomeLabel: string;
  side: 'BUY';
  entryPrice: number;
  sizeUsd: number;
  shares: number;
  kellyFraction: number;
  strategy: string;
  status: 'open' | 'won' | 'lost' | 'voided';
  createdAt: number;
  resolvedAt?: number;
  realizedPnl?: number;
  voidedReason?: string;
}

export interface PortfolioState {
  paperCapital: number;
  freeCapital: number;
  deployedUsd: number;
  openPositionCount: number;
  dailyRealizedPnl: number;
  totalDrawdownPct: number;
}
```

- [ ] **Step 4: Run test → passes**

Run: `npx vitest run src/poly/types.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/poly/types.ts src/poly/types.test.ts
git commit -m "feat(poly): add types and zod schemas"
```

---

## Task 5: Gamma client

**Files:**
- Create: `src/poly/gamma-client.ts`
- Test: `src/poly/gamma-client.test.ts`

Adapter layer: raw Gamma → normalized `Market`.

- [ ] **Step 1: Write the adapter test**

```typescript
// src/poly/gamma-client.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeMarket } from './gamma-client.js';

describe('normalizeMarket', () => {
  it('zips outcomes, tokenIds, and prices into structured array', () => {
    const raw = {
      conditionId: '0xabc', slug: 'x', question: 'Will X?',
      outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["t1","t2"]',
      volume24hr: 100, liquidity: 50,
      endDate: '2026-12-31T23:59:59Z', closed: false,
    };
    const m = normalizeMarket(raw);
    expect(m.outcomes).toEqual([
      { label: 'Yes', tokenId: 't1', price: 0.42 },
      { label: 'No',  tokenId: 't2', price: 0.58 },
    ]);
    expect(m.endDate).toBeGreaterThan(1_700_000_000);
  });

  it('throws on mismatched array lengths', () => {
    const raw = { /* outcomes len 2, prices len 1 */ };
    expect(() => normalizeMarket(raw)).toThrow();
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `npx vitest run src/poly/gamma-client.test.ts`

- [ ] **Step 3: Implement client + adapter**

```typescript
// src/poly/gamma-client.ts
import { logger } from '../logger.js';
import { GammaMarketSchema, type GammaMarket, type Market } from './types.js';

const BASE = 'https://gamma-api.polymarket.com';

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function getJson(url: string, attempt = 0): Promise<unknown> {
  const res = await fetch(url);
  if (res.status === 429 && attempt < 4) {
    await sleep(1000 * 2 ** attempt);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gamma ${res.status}: ${url}`);
  return res.json();
}

export function normalizeMarket(raw: unknown): Market {
  const g: GammaMarket = GammaMarketSchema.parse(raw);
  if (g.outcomes.length !== g.outcomePrices.length || g.outcomes.length !== g.clobTokenIds.length) {
    throw new Error(`market ${g.slug}: outcome/price/tokenId length mismatch`);
  }
  const outcomes = g.outcomes.map((label, i) => ({
    label,
    tokenId: g.clobTokenIds[i]!,
    price: g.outcomePrices[i]!,
  }));
  return {
    slug: g.slug,
    conditionId: g.conditionId,
    question: g.question,
    category: g.category,
    outcomes,
    volume24h: g.volume24hr,
    liquidity: g.liquidity,
    endDate: Math.floor(new Date(g.endDate).getTime() / 1000),
    closed: g.closed,
  };
}

export async function fetchActiveMarkets(pageSize = 500): Promise<Market[]> {
  const out: Market[] = [];
  let offset = 0;
  while (true) {
    const raw = await getJson(`${BASE}/markets?active=true&closed=false&limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const r of raw) {
      try { out.push(normalizeMarket(r)); }
      catch (e) { logger.warn({ err: String(e) }, 'skipping malformed market'); }
    }
    if (raw.length < pageSize) break;
    offset += pageSize;
    await sleep(200);
  }
  return out;
}

export async function fetchMarketBySlug(slug: string): Promise<Market | null> {
  try {
    const raw = await getJson(`${BASE}/markets/${encodeURIComponent(slug)}`);
    return normalizeMarket(raw);
  } catch (err) {
    logger.warn({ slug, err: String(err) }, 'fetchMarketBySlug failed');
    return null;
  }
}
```

- [ ] **Step 4: Run test → passes**

Run: `npx vitest run src/poly/gamma-client.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/poly/gamma-client.ts src/poly/gamma-client.test.ts
git commit -m "feat(poly): gamma client with raw→normalized adapter"
```

---

## Task 6: CLOB client

**Files:**
- Create: `src/poly/clob-client.ts`
- Test: `src/poly/clob-client.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/poly/clob-client.test.ts
import { describe, it, expect } from 'vitest';
import { parseBook, bestAskAndDepth } from './clob-client.js';

describe('parseBook / bestAskAndDepth', () => {
  it('returns best ask and summed ask depth', () => {
    const b = parseBook({ bids: [{ price: '0.41', size: '100' }], asks: [{ price: '0.43', size: '50' }, { price: '0.44', size: '100' }] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBe(0.43);
    expect(r.askDepthShares).toBe(150);
  });

  it('returns nulls on empty book', () => {
    const b = parseBook({ bids: [], asks: [] });
    const r = bestAskAndDepth(b);
    expect(r.bestAsk).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fails**

- [ ] **Step 3: Implement**

```typescript
// src/poly/clob-client.ts
import { ClobBookSchema, type ClobBook } from './types.js';
import { logger } from '../logger.js';

const BASE = 'https://clob.polymarket.com';

export function parseBook(raw: unknown): ClobBook {
  return ClobBookSchema.parse(raw);
}

export function bestAskAndDepth(book: ClobBook): { bestAsk: number | null; askDepthShares: number } {
  const asks = book.asks.slice().sort((a, b) => a.price - b.price);
  if (asks.length === 0) return { bestAsk: null, askDepthShares: 0 };
  return {
    bestAsk: asks[0]!.price,
    askDepthShares: asks.reduce((s, l) => s + l.size, 0),
  };
}

export async function fetchBook(tokenId: string): Promise<ClobBook | null> {
  try {
    const res = await fetch(`${BASE}/book?token_id=${encodeURIComponent(tokenId)}`);
    if (!res.ok) return null;
    return parseBook(await res.json());
  } catch (err) {
    logger.warn({ tokenId, err: String(err) }, 'fetchBook failed');
    return null;
  }
}

export async function fetchMidpoint(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`);
    if (!res.ok) return null;
    const json = await res.json() as { mid?: unknown };
    const n = typeof json.mid === 'string' ? Number(json.mid) : typeof json.mid === 'number' ? json.mid : NaN;
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run → passes**

- [ ] **Step 5: Commit**

```bash
git add src/poly/clob-client.ts src/poly/clob-client.test.ts
git commit -m "feat(poly): CLOB client (book + midpoint)"
```

---

## Task 7: Market scanner + price history

**Files:**
- Create: `src/poly/market-scanner.ts`
- Test: `src/poly/market-scanner.test.ts`

Emits `scan_complete` event. Upserts markets. Writes price-history snapshot. Prunes rows older than 36h.

- [ ] **Step 1: Test upsert + prune**

```typescript
// src/poly/market-scanner.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { upsertMarkets, pruneOldPrices, getPriceApproxHoursAgo } from './market-scanner.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  // copy the DDL from migrations/v1.2.0-poly.ts (only tables needed by scanner)
  db.exec(`CREATE TABLE poly_markets (...);`);
  db.exec(`CREATE TABLE poly_price_history (...);`);
  return db;
}

describe('market-scanner persistence', () => {
  it('upserts markets and writes price history', () => { /* ... */ });
  it('pruneOldPrices removes rows older than 36h', () => { /* ... */ });
  it('getPriceApproxHoursAgo finds nearest match within tolerance', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement scanner**

```typescript
// src/poly/market-scanner.ts
import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { fetchActiveMarkets } from './gamma-client.js';
import type { Market } from './types.js';

export class MarketScanner extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(private db: Database.Database, private intervalMs: number) {
    super();
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async runOnce(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    try {
      const markets = await fetchActiveMarkets();
      upsertMarkets(this.db, markets);
      capturePrices(this.db, markets);
      pruneOldPrices(this.db);
      logger.info({ count: markets.length, ms: Date.now() - started }, 'poly scan complete');
      this.emit('scan_complete', { markets });
    } catch (err) {
      logger.error({ err: String(err) }, 'poly scan failed');
      this.emit('scan_error', { error: String(err) });
    } finally {
      this.scanning = false;
    }
  }
}

export function upsertMarkets(db: Database.Database, markets: Market[]): void {
  const stmt = db.prepare(`
    INSERT INTO poly_markets (slug, condition_id, question, category, outcomes_json, volume_24h, liquidity, end_date, closed, last_scan_at)
    VALUES (@slug, @condition_id, @question, @category, @outcomes_json, @volume_24h, @liquidity, @end_date, @closed, @last_scan_at)
    ON CONFLICT(slug) DO UPDATE SET
      question=excluded.question, category=excluded.category, outcomes_json=excluded.outcomes_json,
      volume_24h=excluded.volume_24h, liquidity=excluded.liquidity, end_date=excluded.end_date,
      closed=excluded.closed, last_scan_at=excluded.last_scan_at
  `);
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((rows: Market[]) => {
    for (const m of rows) {
      stmt.run({
        slug: m.slug, condition_id: m.conditionId, question: m.question,
        category: m.category ?? null,
        outcomes_json: JSON.stringify(m.outcomes),
        volume_24h: m.volume24h, liquidity: m.liquidity,
        end_date: m.endDate, closed: m.closed ? 1 : 0,
        last_scan_at: now,
      });
    }
  });
  tx(markets);
}

export function capturePrices(db: Database.Database, markets: Market[]): void {
  const stmt = db.prepare(`INSERT OR REPLACE INTO poly_price_history (token_id, captured_at, price) VALUES (?, ?, ?)`);
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction((rows: Market[]) => {
    for (const m of rows) for (const o of m.outcomes) stmt.run(o.tokenId, now, o.price);
  });
  tx(markets);
}

export function pruneOldPrices(db: Database.Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - 36 * 3600;
  db.prepare(`DELETE FROM poly_price_history WHERE captured_at < ?`).run(cutoff);
}

export function getPriceApproxHoursAgo(db: Database.Database, tokenId: string, hoursAgo: number, toleranceHours = 1): number | null {
  const target = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
  const tolSec = toleranceHours * 3600;
  const row = db.prepare(`
    SELECT price FROM poly_price_history
    WHERE token_id = ? AND captured_at BETWEEN ? AND ?
    ORDER BY ABS(captured_at - ?) LIMIT 1
  `).get(tokenId, target - tolSec, target + tolSec, target) as { price: number } | undefined;
  return row?.price ?? null;
}
```

- [ ] **Step 3: Run tests → pass**

- [ ] **Step 4: Commit**

```bash
git add src/poly/market-scanner.ts src/poly/market-scanner.test.ts
git commit -m "feat(poly): market scanner with price history"
```

---

## Task 8: Phase A Telegram commands

**Files:**
- Create: `src/poly/telegram-commands.ts`
- Create: `src/poly/format.ts` (shared truncation + formatting helpers)
- Test: `src/poly/format.test.ts`

- [ ] **Step 1: Test the truncation helper**

```typescript
// src/poly/format.test.ts
import { describe, it, expect } from 'vitest';
import { truncateForTelegram, formatMarketList } from './format.js';

describe('truncateForTelegram', () => {
  it('returns input unchanged under cap', () => {
    expect(truncateForTelegram('hi', 10)).toEqual({ text: 'hi', truncated: 0 });
  });
  it('truncates with footer', () => {
    const long = 'x'.repeat(5000);
    const r = truncateForTelegram(long, 100);
    expect(r.text.length).toBeLessThanOrEqual(100);
    expect(r.truncated).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement format helpers**

```typescript
// src/poly/format.ts
export const TELEGRAM_CAP = 3800; // leave headroom under 4096

export function truncateForTelegram(text: string, cap = TELEGRAM_CAP): { text: string; truncated: number } {
  if (text.length <= cap) return { text, truncated: 0 };
  const head = text.slice(0, cap);
  return { text: head + `\n… (truncated, ${text.length - cap} chars)`, truncated: text.length - cap };
}

export function fmtUsd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function fmtPrice(n: number): string {
  return '$' + n.toFixed(2);
}

export function truncateQuestion(q: string, max = 80): string {
  return q.length <= max ? q : q.slice(0, max - 1) + '…';
}
```

- [ ] **Step 3: Implement commands**

```typescript
// src/poly/telegram-commands.ts
import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { fetchBook } from './clob-client.js';
import { getPriceApproxHoursAgo } from './market-scanner.js';
import { truncateForTelegram, fmtUsd, fmtPrice, truncateQuestion } from './format.js';

export function registerPolyCommands(bot: Bot<Context>, db: Database.Database): void {
  bot.command('poly', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const parts = text.replace(/^\/poly\s*/, '').trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() || 'help';
    const arg = parts[1] || '';
    try {
      switch (sub) {
        case 'markets':   return void await ctx.reply(truncateForTelegram(renderMarkets(db)).text);
        case 'market':    return void await ctx.reply(truncateForTelegram(await renderMarket(db, arg)).text);
        case 'trending':  return void await ctx.reply(truncateForTelegram(renderTrending(db)).text);
        case 'closing':   return void await ctx.reply(truncateForTelegram(renderClosing(db)).text);
        case 'status':    return void await ctx.reply(truncateForTelegram(renderStatus(db)).text);
        default:
          return void await ctx.reply(HELP);
      }
    } catch (err) {
      logger.error({ err: String(err), sub }, '/poly command failed');
      await ctx.reply(`Error: ${String(err).slice(0, 200)}`);
    }
  });
  logger.info('Poly commands registered (/poly)');
}

const HELP =
`Polymarket commands:
/poly markets — top 10 by 24h volume
/poly market <slug> — full detail
/poly trending — biggest 24h movers
/poly closing — resolving in next 24h
/poly status — bot health`;

function renderMarkets(db: Database.Database): string {
  const rows = db.prepare(`SELECT slug, question, outcomes_json, volume_24h FROM poly_markets WHERE closed=0 ORDER BY volume_24h DESC LIMIT 10`).all() as Array<{ slug: string; question: string; outcomes_json: string; volume_24h: number }>;
  if (rows.length === 0) return 'No markets cached yet. Scanner may still be running.';
  return ['Top 10 by 24h volume:', ''].concat(rows.map((r, i) => {
    const outcomes = JSON.parse(r.outcomes_json) as Array<{ label: string; price: number }>;
    const yes = outcomes.find(o => o.label.toLowerCase() === 'yes') ?? outcomes[0]!;
    return `${i + 1}. ${truncateQuestion(r.question)} — ${yes.label} ${fmtPrice(yes.price)} — ${fmtUsd(r.volume_24h)}`;
  })).join('\n');
}

async function renderMarket(db: Database.Database, slug: string): Promise<string> {
  if (!slug) return 'Usage: /poly market <slug>';
  const row = db.prepare(`SELECT * FROM poly_markets WHERE slug = ?`).get(slug) as { slug: string; question: string; category: string | null; outcomes_json: string; volume_24h: number; liquidity: number; end_date: number } | undefined;
  if (!row) return `No market '${slug}'. Try /poly markets to see active markets.`;
  const outcomes = JSON.parse(row.outcomes_json) as Array<{ label: string; tokenId: string; price: number }>;
  const lines = [
    row.question,
    `Category: ${row.category ?? 'n/a'}`,
    `24h volume: ${fmtUsd(row.volume_24h)}  Liquidity: ${fmtUsd(row.liquidity)}`,
    `Ends: ${new Date(row.end_date * 1000).toISOString().slice(0, 16)}Z`,
    '',
    'Outcomes:',
    ...outcomes.map(o => `  ${o.label}: ${fmtPrice(o.price)}  (${(o.price * 100).toFixed(1)}% implied)`),
  ];
  const firstBook = await fetchBook(outcomes[0]!.tokenId);
  if (firstBook) {
    lines.push('', `Orderbook (${outcomes[0]!.label}):`);
    const topBids = firstBook.bids.slice(0, 3);
    const topAsks = firstBook.asks.slice(0, 3);
    lines.push(`  Best bid/ask: ${topBids[0] ? fmtPrice(topBids[0].price) : '—'} / ${topAsks[0] ? fmtPrice(topAsks[0].price) : '—'}`);
  }
  return lines.join('\n');
}

function renderTrending(db: Database.Database): string {
  // Compute 24h delta per market using getPriceApproxHoursAgo on YES token;
  // fall back to "insufficient history" if too few rows.
  const markets = db.prepare(`SELECT slug, question, outcomes_json FROM poly_markets WHERE closed=0 LIMIT 200`).all() as Array<{ slug: string; question: string; outcomes_json: string }>;
  const scored: Array<{ slug: string; question: string; delta: number; now: number }> = [];
  for (const m of markets) {
    const outcomes = JSON.parse(m.outcomes_json) as Array<{ label: string; tokenId: string; price: number }>;
    const yes = outcomes.find(o => o.label.toLowerCase() === 'yes') ?? outcomes[0]!;
    const old = getPriceApproxHoursAgo(db, yes.tokenId, 24);
    if (old === null) continue;
    scored.push({ slug: m.slug, question: m.question, delta: yes.price - old, now: yes.price });
  }
  if (scored.length === 0) return 'Trending: insufficient price history (needs ~24h of scans).';
  scored.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return ['Top 10 biggest 24h moves:', ''].concat(
    scored.slice(0, 10).map((s, i) => `${i + 1}. ${truncateQuestion(s.question)} — ${fmtPrice(s.now)} (${s.delta >= 0 ? '+' : ''}${(s.delta * 100).toFixed(1)}pp)`),
  ).join('\n');
}

function renderClosing(db: Database.Database): string {
  const now = Math.floor(Date.now() / 1000);
  const soon = now + 24 * 3600;
  const rows = db.prepare(`
    SELECT slug, question, end_date, volume_24h, outcomes_json
    FROM poly_markets WHERE closed=0 AND end_date BETWEEN ? AND ? AND volume_24h >= 10000
    ORDER BY end_date ASC LIMIT 15
  `).all(now, soon) as Array<{ slug: string; question: string; end_date: number; volume_24h: number; outcomes_json: string }>;
  if (rows.length === 0) return 'No markets closing in the next 24h with ≥$10k volume.';
  return ['Markets resolving in next 24h (≥$10k vol):', ''].concat(rows.map(r => {
    const hrs = ((r.end_date - now) / 3600).toFixed(1);
    return `${truncateQuestion(r.question)} — closes in ${hrs}h — ${fmtUsd(r.volume_24h)} vol`;
  })).join('\n');
}

function renderStatus(db: Database.Database): string {
  const latest = db.prepare(`SELECT MAX(last_scan_at) AS t FROM poly_markets`).get() as { t: number | null };
  const marketCount = db.prepare(`SELECT COUNT(*) AS c FROM poly_markets WHERE closed=0`).get() as { c: number };
  const sigCounts = db.prepare(`
    SELECT SUM(approved=1) AS a, SUM(approved=0) AS r
    FROM poly_signals WHERE created_at >= ?
  `).get(Math.floor(Date.now() / 1000) - 86400) as { a: number | null; r: number | null };
  const halt = db.prepare(`SELECT value FROM kv WHERE key='poly.halt'`).get() as { value: string } | undefined;
  const open = db.prepare(`SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='open'`).get() as { c: number };
  const lastScanIso = latest.t ? new Date(latest.t * 1000).toISOString() : 'never';
  return [
    `Last scan: ${lastScanIso}`,
    `Active markets cached: ${marketCount.c}`,
    `Signals last 24h: ${sigCounts.a ?? 0} approved / ${sigCounts.r ?? 0} rejected`,
    `Open paper positions: ${open.c}`,
    `Mode: paper  Halt: ${halt?.value === '1' ? 'YES' : 'no'}`,
  ].join('\n');
}
```

- [ ] **Step 4: Verify build**

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/poly/telegram-commands.ts src/poly/format.ts src/poly/format.test.ts
git commit -m "feat(poly): phase A /poly telegram commands"
```

---

## Task 9: Daily digest

**Files:**
- Create: `src/poly/digest.ts`
- Test: `src/poly/digest.test.ts`

- [ ] **Step 1: Test digest composition and day-gating**

```typescript
// src/poly/digest.test.ts
import { describe, it, expect } from 'vitest';
import { shouldRunDigest, composeDigest } from './digest.js';

describe('shouldRunDigest', () => {
  it('returns true when current hour matches and not yet run today', () => {
    expect(shouldRunDigest({ hour: 6, timezone: 'UTC', now: new Date('2026-04-12T06:30:00Z'), lastRunYmd: '2026-04-11' })).toBe(true);
  });
  it('returns false if already run today', () => {
    expect(shouldRunDigest({ hour: 6, timezone: 'UTC', now: new Date('2026-04-12T06:30:00Z'), lastRunYmd: '2026-04-12' })).toBe(false);
  });
  it('returns false before the configured hour', () => {
    expect(shouldRunDigest({ hour: 6, timezone: 'UTC', now: new Date('2026-04-12T05:30:00Z'), lastRunYmd: '2026-04-11' })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/poly/digest.ts
import type Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { POLY_DIGEST_HOUR, POLY_TIMEZONE, POLY_MIN_EDGE_PCT } from '../config.js';
import { fmtUsd, fmtPrice, truncateQuestion } from './format.js';

export interface ShouldRunArgs { hour: number; timezone: string; now: Date; lastRunYmd: string | null; }
export function shouldRunDigest(args: ShouldRunArgs): boolean {
  const dt = DateTime.fromJSDate(args.now).setZone(args.timezone);
  const ymd = dt.toFormat('yyyy-LL-dd');
  return dt.hour >= args.hour && args.lastRunYmd !== ymd;
}

export function composeDigest(db: Database.Database): { text: string; ymd: string } {
  const tzNow = DateTime.now().setZone(POLY_TIMEZONE);
  const ymd = tzNow.toFormat('yyyy-LL-dd');
  const top5 = db.prepare(`SELECT slug, question, outcomes_json, volume_24h FROM poly_markets WHERE closed=0 ORDER BY volume_24h DESC LIMIT 5`).all() as Array<{ slug: string; question: string; outcomes_json: string; volume_24h: number }>;
  const edgeCutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
  const highEdge = db.prepare(`
    SELECT market_slug, outcome_label, market_price, estimated_prob, edge_pct
    FROM poly_signals WHERE approved=1 AND created_at >= ? AND edge_pct >= ?
    ORDER BY edge_pct DESC LIMIT 5
  `).all(edgeCutoff, POLY_MIN_EDGE_PCT) as Array<{ market_slug: string; outcome_label: string; market_price: number; estimated_prob: number; edge_pct: number }>;
  const openCount = (db.prepare(`SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='open'`).get() as { c: number }).c;
  const dayStart = tzNow.startOf('day').toSeconds();
  const dayPnl = (db.prepare(`SELECT COALESCE(SUM(realized_pnl), 0) AS p FROM poly_paper_trades WHERE resolved_at >= ? AND status IN ('won','lost')`).get(dayStart) as { p: number }).p;

  const lines: string[] = [
    `Polymarket daily — ${ymd}`,
    '',
    'Top 5 by volume (24h):',
    ...top5.map((r, i) => {
      const outcomes = JSON.parse(r.outcomes_json) as Array<{ label: string; price: number }>;
      const yes = outcomes.find(o => o.label.toLowerCase() === 'yes') ?? outcomes[0]!;
      return `  ${i + 1}. ${truncateQuestion(r.question)} — ${yes.label} ${fmtPrice(yes.price)} — ${fmtUsd(r.volume_24h)} vol`;
    }),
    '',
    'High-edge signals pending review:',
    highEdge.length === 0 ? '  (none)' : '',
    ...highEdge.map(h => `  • ${truncateQuestion(h.market_slug)} — market ${fmtPrice(h.market_price)}, model ${(h.estimated_prob*100).toFixed(1)}%, edge +${h.edge_pct.toFixed(1)}%`),
    '',
    `Open paper positions: ${openCount}  |  Realized P&L today: $${dayPnl.toFixed(2)}`,
  ].filter(l => l !== '');
  return { text: lines.join('\n'), ymd };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/poly/digest.ts src/poly/digest.test.ts
git commit -m "feat(poly): daily digest with timezone-aware gating"
```

---

## Task 10: Wire Phase A into bot

**Files:**
- Create: `src/poly/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Build index.ts orchestrator**

```typescript
// src/poly/index.ts
import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { POLY_ENABLED, POLY_SCAN_INTERVAL_MIN, POLY_TIMEZONE, POLY_DIGEST_HOUR } from '../config.js';
import { MarketScanner } from './market-scanner.js';
import { registerPolyCommands } from './telegram-commands.js';
import { composeDigest, shouldRunDigest } from './digest.js';

type Sender = (text: string) => Promise<void>;

interface KvRow { key: string; value: string }
const kvGet = (db: Database.Database, key: string): string | null =>
  (db.prepare(`SELECT value FROM kv WHERE key=?`).get(key) as KvRow | undefined)?.value ?? null;
const kvSet = (db: Database.Database, key: string, value: string): void => {
  db.prepare(`INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
};

export function initPoly(opts: { bot: Bot<Context>; sender: Sender; db: Database.Database; }): { scanner: MarketScanner; stop: () => void } {
  if (!POLY_ENABLED) {
    logger.info('POLY_ENABLED=false — polymarket module disabled');
    return { scanner: null as unknown as MarketScanner, stop: () => {} };
  }

  const scanner = new MarketScanner(opts.db, POLY_SCAN_INTERVAL_MIN * 60_000);
  scanner.start();
  registerPolyCommands(opts.bot, opts.db);

  // Digest tick — every 5 minutes, fires once/day
  const digestTimer = setInterval(() => {
    try {
      const lastYmd = kvGet(opts.db, 'poly.last_digest_ymd');
      if (shouldRunDigest({ hour: POLY_DIGEST_HOUR, timezone: POLY_TIMEZONE, now: new Date(), lastRunYmd: lastYmd })) {
        const { text, ymd } = composeDigest(opts.db);
        void opts.sender(text).then(() => kvSet(opts.db, 'poly.last_digest_ymd', ymd));
      }
    } catch (err) { logger.error({ err: String(err) }, 'digest tick failed'); }
  }, 5 * 60_000);

  logger.info('Polymarket module initialized');
  return {
    scanner,
    stop: () => { scanner.stop(); clearInterval(digestTimer); },
  };
}
```

- [ ] **Step 2: Wire into `src/index.ts`**

Locate where `initTrading(...)` is called (add a grep step: `grep -n "initTrading" src/index.ts`). Immediately after it, add:

```typescript
import { initPoly } from './poly/index.js';
// ...
const poly = initPoly({ bot, sender: telegramSender, db });
```

Use whatever identifier names for `bot`, sender, and `db` already exist in that file.

- [ ] **Step 3: Build + start locally**

```bash
npm run build && POLY_ENABLED=true npm run start
```

From Telegram, send `/poly status`. Expected: status message. `/poly markets` after the first 15m scan completes (or wait + retry).

- [ ] **Step 4: Commit**

```bash
git add src/poly/index.ts src/index.ts
git commit -m "feat(poly): wire phase A into bot startup"
```

**Phase A is shippable at the end of Task 10.** Run for 24h before starting Phase C so the daily digest fires at least once and the price-history table fills up.

---

## Task 11: AI-probability strategy + eval cache

**Files:**
- Create: `src/poly/strategies/ai-probability.ts`
- Test: `src/poly/strategies/ai-probability.test.ts`

- [ ] **Step 1: Test cache key + edge calc**

```typescript
import { describe, it, expect } from 'vitest';
import { computeCacheKey, computeEdgePct } from './ai-probability.js';

describe('ai-probability helpers', () => {
  it('computes edge in percentage points', () => {
    expect(computeEdgePct(0.58, 0.42)).toBeCloseTo(16, 5);
  });
  it('cache key stable for same inputs quantized', () => {
    const k1 = computeCacheKey('slug', 'tok', { ask: 0.421, volume: 12300 });
    const k2 = computeCacheKey('slug', 'tok', { ask: 0.419, volume: 12700 }); // both round to same buckets
    expect(k1).toBe(k2);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/poly/strategies/ai-probability.ts
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { ANTHROPIC_API_KEY, POLY_MODEL } from '../../config.js';
import { ProbabilityEstimateSchema, type ProbabilityEstimate, type Market } from '../types.js';
import { logger } from '../../logger.js';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const PROMPT_VERSION = 'v1';

export function computeEdgePct(estimated: number, marketAsk: number): number {
  return (estimated - marketAsk) * 100;
}

export function computeCacheKey(slug: string, tokenId: string, params: { ask: number; volume: number }): string {
  // quantize ask to nearest 1%, volume to nearest $1k, to hit cache more often
  const ask = Math.round(params.ask * 100);
  const vol = Math.round(params.volume / 1000);
  return crypto.createHash('sha256').update(`${PROMPT_VERSION}|${slug}|${tokenId}|${ask}|${vol}`).digest('hex');
}

interface EvaluateArgs { market: Market; outcome: Market['outcomes'][number]; bestAsk: number; bestBid: number | null; spreadPct: number | null; askDepthUsd: number; db: Database.Database; }

export async function evaluateMarket(args: EvaluateArgs): Promise<ProbabilityEstimate | null> {
  const key = computeCacheKey(args.market.slug, args.outcome.tokenId, { ask: args.bestAsk, volume: args.market.volume24h });
  const cached = args.db.prepare(`SELECT probability, confidence, reasoning, contrarian, created_at FROM poly_eval_cache WHERE cache_key=?`).get(key) as { probability: number; confidence: string; reasoning: string; contrarian: string | null; created_at: number } | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (cached && (now - cached.created_at) < 2 * 3600) {
    return { probability: cached.probability, confidence: cached.confidence as ProbabilityEstimate['confidence'], reasoning: cached.reasoning, contrarian: cached.contrarian ?? undefined };
  }

  const system = `You are a prediction-market probability estimator. Given a market question and context, return a JSON object:
{"probability": 0.0-1.0, "confidence": "low"|"medium"|"high", "reasoning": "1-3 sentences", "contrarian": "1-2 sentences"}
Output JSON only, no prose.`;
  const user = [
    `Question: ${args.market.question}`,
    `Category: ${args.market.category ?? 'unknown'}`,
    `End date: ${new Date(args.market.endDate * 1000).toISOString()}`,
    `Current ${args.outcome.label} ask: $${args.bestAsk.toFixed(3)}`,
    `Spread: ${args.spreadPct === null ? 'n/a' : args.spreadPct.toFixed(1) + '%'}`,
    `Ask depth: $${args.askDepthUsd.toFixed(0)}`,
    `24h volume: $${args.market.volume24h.toFixed(0)}`,
  ].join('\n');

  try {
    const resp = await client.messages.create({
      model: POLY_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const block = resp.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') return null;
    const parsed = ProbabilityEstimateSchema.safeParse(JSON.parse(block.text));
    if (!parsed.success) { logger.warn({ errors: parsed.error.issues }, 'probability estimate failed zod'); return null; }
    args.db.prepare(`INSERT OR REPLACE INTO poly_eval_cache (cache_key, slug, outcome_token_id, created_at, probability, confidence, reasoning, contrarian) VALUES (?,?,?,?,?,?,?,?)`)
      .run(key, args.market.slug, args.outcome.tokenId, now, parsed.data.probability, parsed.data.confidence, parsed.data.reasoning, parsed.data.contrarian ?? null);
    return parsed.data;
  } catch (err) {
    logger.warn({ err: String(err), slug: args.market.slug }, 'evaluateMarket failed');
    return null;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/poly/strategies/`

- [ ] **Step 4: Commit**

```bash
git add src/poly/strategies/
git commit -m "feat(poly): ai-probability strategy with persistent eval cache"
```

---

## Task 12: Risk gates

**Files:**
- Create: `src/poly/risk-gates.ts`
- Test: `src/poly/risk-gates.test.ts`

Pure functions. Each gate returns `{ passed, reason? }`. Unit-testable without DB.

- [ ] **Step 1: Write exhaustive gate tests**

```typescript
import { describe, it, expect } from 'vitest';
import { gate1PositionLimits, gate2PortfolioHealth, gate3SignalQuality } from './risk-gates.js';

describe('gate1PositionLimits', () => {
  // test each rule: max positions, max deployed %, dup position, max per-trade
});
describe('gate2PortfolioHealth', () => {
  // daily loss breach, halt drawdown, free capital
});
describe('gate3SignalQuality', () => {
  // min edge, min TTR, depth, 3% drift
});
```

- [ ] **Step 2: Implement**

Per spec §4.3. Exports three pure gate functions + a composed `runAllGates(signal, portfolio, market, orderbookSnapshot, config) → { passed, rejections[] }`. All gates run even if one fails (collects all rejection reasons).

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add src/poly/risk-gates.ts src/poly/risk-gates.test.ts
git commit -m "feat(poly): three deterministic risk gates"
```

---

## Task 13: Paper broker

**Files:**
- Create: `src/poly/paper-broker.ts`
- Test: `src/poly/paper-broker.test.ts`

- [ ] **Step 1: Test execute path (signal → trade + position + signal update, all in txn)**

Use `:memory:` DB with the poly schema. Assert that on success three rows exist (trade, position, signal.paper_trade_id set). Assert rollback on stale-orderbook abort (no trade row).

- [ ] **Step 2: Implement** `execute(signal, currentBestAsk, askDepthShares) → { status: 'filled' | 'aborted'; tradeId?: number; reason?: string }`

Per spec §4.5. Single `db.transaction()` for all three writes. Abort-on-drift check against signal price.

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add src/poly/paper-broker.ts src/poly/paper-broker.test.ts
git commit -m "feat(poly): paper broker with transactional execution"
```

---

## Task 14: P&L tracker

**Files:**
- Create: `src/poly/pnl-tracker.ts`
- Test: `src/poly/pnl-tracker.test.ts`

- [ ] **Step 1: Test resolution math**

- won: `realized_pnl = shares * (1 - entry_price)`
- lost: `realized_pnl = -shares * entry_price`
- voided: `realized_pnl = 0`

- [ ] **Step 2: Implement** hourly loop that:
  1. Iterates open trades
  2. Fetches midpoint for `current_price`, updates `poly_positions.unrealized_pnl`
  3. Checks Gamma `closed` + `resolution`; on closed, determines win/lose/void, updates `poly_paper_trades.status`, removes row from `poly_positions`
  4. Emits `position_resolved` event

- [ ] **Step 3: Commit**

```bash
git add src/poly/pnl-tracker.ts src/poly/pnl-tracker.test.ts
git commit -m "feat(poly): hourly pnl tracker with resolution"
```

---

## Task 15: Strategy engine

**Files:**
- Create: `src/poly/strategy-engine.ts`
- Test: `src/poly/strategy-engine.test.ts`

Orchestrates: on `scan_complete`, iterate fresh markets → for each candidate (passes pre-filter) → check halt flag → fetch orderbook → run strategy → run risk gates → on approved, call broker. Writes signal row either way (approved or with rejection_reasons).

- [ ] **Step 1: Test halt-flag blocks execution**

- [ ] **Step 2: Test rejection writes row with reasons and no trade**

- [ ] **Step 3: Test approval writes row with paper_trade_id**

- [ ] **Step 4: Implement with clear logging at each step**

- [ ] **Step 5: Commit**

```bash
git add src/poly/strategy-engine.ts src/poly/strategy-engine.test.ts
git commit -m "feat(poly): strategy engine orchestrator"
```

---

## Task 16: Alerts

**Files:**
- Create: `src/poly/alerts.ts`
- Test: `src/poly/alerts.test.ts`

Mirrors `src/trading/alerts.ts`: constructor takes `sender`, has `.toggle(bool)`, `.isEnabled()`. Methods: `signalApproved(signal, trade)`, `riskBreach(gate, reason)`, `positionResolved(trade)`, `scanStale(minutesStale)`.

- [ ] **Step 1: Test format strings** (exact text) and on/off toggle.

- [ ] **Step 2: Implement; persist `poly.alerts_enabled` in kv**

- [ ] **Step 3: Commit**

```bash
git add src/poly/alerts.ts src/poly/alerts.test.ts
git commit -m "feat(poly): event-driven alerts"
```

---

## Task 17: Phase C commands

**Files:**
- Modify: `src/poly/telegram-commands.ts`

Add these sub-commands:

| Command | Renderer |
|---------|----------|
| `/poly signals` | last 20 from `poly_signals`, approved/rejected + reasons |
| `/poly positions` | join `poly_positions` × `poly_paper_trades` where status='open', show live unrealized P&L |
| `/poly pnl` | sum realized + unrealized, win rate (last 30d), count vs 200-trade threshold |
| `/poly halt` | set `poly.halt=1` in kv |
| `/poly resume` | set `poly.halt=0` |
| `/poly mode [paper\|live]` | shows current; refuses `live` with: `"Live mode unlocks after 200+ paper trades; separate design required."` |
| `/poly alerts on\|off` | toggle via alertManager |

- [ ] Each sub-command gets a renderer function + test if logic exists (rendering vs kv toggles).

- [ ] Commit:

```bash
git commit -am "feat(poly): phase C /poly commands"
```

---

## Task 18: Wire Phase C into bot

**Files:**
- Modify: `src/poly/index.ts`

- [ ] Add to `initPoly`:
  - Construct `alertManager`, `pnlTracker`, `strategyEngine`
  - Subscribe `strategyEngine` to `scanner.on('scan_complete', ...)`
  - Subscribe `alertManager.signalApproved` to `strategyEngine.on('signal_approved', ...)`, etc.
  - Subscribe `alertManager.positionResolved` to `pnlTracker.on('position_resolved', ...)`
  - Start `pnlTracker` (`setInterval` every hour)
  - Pass `alertManager` into `registerPolyCommands` so `/poly alerts` can toggle it

- [ ] Stop hook: ensure all timers clear on the existing SIGTERM shutdown path.

- [ ] Build, start, manual QA:
  1. `/poly halt` → confirm no new signals for 5m
  2. `/poly resume` → confirm signals resume next scan
  3. Wait for at least one approved signal → confirm alert message fires

- [ ] Commit:

```bash
git commit -am "feat(poly): wire phase C — strategy engine, pnl tracker, alerts"
```

---

## Task 19: End-to-end manual QA

Runbook. Execute after Task 18 and let it run for 48h before declaring Phase C done.

- [ ] Restart the bot and confirm `poly.halt` state survives (set to 1, restart, check it's still 1)
- [ ] `/poly markets` → 10 rows
- [ ] `/poly market <slug>` with a known good slug → full detail with orderbook
- [ ] `/poly market does-not-exist` → clean "no market" message
- [ ] `/poly closing` → rows or "none" message
- [ ] `/poly status` → all fields populated
- [ ] After 24h: `/poly trending` returns movers (not "insufficient history")
- [ ] 6am digest message received on day 1
- [ ] At least 20 signals logged in `poly_signals` (mix of approved + rejected)
- [ ] At least 5 paper trades in `poly_paper_trades` with status='open'
- [ ] Rejections include at least one from Gate 1 and one from Gate 3 (query `poly_signals.rejection_reasons`)
- [ ] `/poly pnl` shows running numbers
- [ ] Force a resolution: find an open trade whose market just resolved, confirm `pnl-tracker` updates `status` + `realized_pnl` within 1h
- [ ] `/poly mode live` refuses with the expected message
- [ ] `npm run typecheck` clean
- [ ] `npm test` green

When all above tick, merge to main and announce paper-trading phase. Target: 200 trades of evidence before any live-mode design begins.

---

## Post-ship: what's next

- Dashboard endpoints (`/api/poly/positions`, `/signals`, `/pnl`) — extends existing `src/dashboard.ts`
- Multi-model consensus (Gemini + GPT alongside Claude)
- Bull/bear debate agents
- Live execution module (separate design doc required)
- Backtest harness over captured `poly_signals` + historical prices
