import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { fetchBook } from './clob-client.js';
import { getPriceApproxHoursAgo } from './price-history.js';
import { truncateForTelegram, fmtUsd, fmtPrice, truncateQuestion } from './format.js';
import { getDailyRealizedPnl } from './pnl-tracker.js';
import { latestSnapshot } from './calibration.js';
import { latestRegimeSnapshot } from './regime.js';
import { latestItems as latestResearchItems } from './research-ingest.js';
import { composeDriftReport, formatDriftReport } from './drift.js';
import { compareStrategiesOnResolutions } from './strategy-compare.js';
import { POLY_PAPER_CAPITAL, POLY_REFLECTION_ENABLED, ALLOWED_CHAT_ID } from '../config.js';

export function registerPolyCommands(bot: Bot<Context>, db: Database.Database): void {
  bot.command('poly', async (ctx) => {
    if (!ALLOWED_CHAT_ID || ctx.chat?.id.toString() !== ALLOWED_CHAT_ID) return;
    const text = ctx.message?.text ?? '';
    // Strip `/poly` with an optional `@BotName` suffix — Telegram appends
    // the mention in group chats (e.g. `/poly@CCbot1080bot markets`).
    const parts = text.replace(/^\/poly(?:@\w+)?\s*/, '').trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() || 'help';
    const arg = parts[1] || '';
    try {
      switch (sub) {
        case 'markets':
          return void await ctx.reply(truncateForTelegram(renderMarkets(db)).text);
        case 'market':
          return void await ctx.reply(truncateForTelegram(await renderMarket(db, arg)).text);
        case 'trending':
          return void await ctx.reply(truncateForTelegram(renderTrending(db)).text);
        case 'closing':
          return void await ctx.reply(truncateForTelegram(renderClosing(db)).text);
        case 'status':
          return void await ctx.reply(truncateForTelegram(renderStatus(db)).text);
        case 'signals':
          return void await ctx.reply(truncateForTelegram(renderSignals(db)).text);
        case 'positions':
          return void await ctx.reply(truncateForTelegram(renderPositions(db)).text);
        case 'pnl':
          return void await ctx.reply(truncateForTelegram(renderPnl(db)).text);
        case 'calibration':
          return void await ctx.reply(truncateForTelegram(renderCalibration(db)).text);
        case 'regime':
          return void await ctx.reply(truncateForTelegram(renderRegime(db)).text);
        case 'research':
          return void await ctx.reply(truncateForTelegram(renderResearch(db)).text);
        case 'drift':
          return void await ctx.reply(truncateForTelegram(renderDrift(db)).text);
        case 'reflect':
          return void await ctx.reply(truncateForTelegram(renderReflect(db)).text);
        case 'halt':
          return void await ctx.reply(setHalt(db));
        case 'resume':
          return void await ctx.reply(clearHalt(db));
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
/poly status — bot health
/poly signals — last 10 signals (approved + rejected)
/poly positions — open paper positions with unrealized P&L
/poly pnl — daily + lifetime paper P&L summary
/poly calibration — Brier / log loss / curve over recent resolutions
/poly regime — latest macro regime snapshot (VIX / BTC dom / 10y yield)
/poly research — last 10 ingested research items
/poly drift — 24h scan latency, market count trend, rejection mix
/poly reflect — Sprint 2.5 reflection pass: v3 vs v3-reflect Brier on resolved markets
/poly halt — set poly.halt flag (engine short-circuits on next tick; open positions remain)
/poly resume — clear poly.halt flag (engine resumes evaluation on next tick)`;

function renderMarkets(db: Database.Database): string {
  const rows = db.prepare(
    `SELECT slug, question, outcomes_json, volume_24h FROM poly_markets WHERE closed=0 ORDER BY volume_24h DESC LIMIT 10`,
  ).all() as Array<{ slug: string; question: string; outcomes_json: string; volume_24h: number }>;
  if (rows.length === 0) return 'No markets cached yet. Scanner may still be running.';
  return ['Top 10 by 24h volume:', ''].concat(
    rows.map((r, i) => {
      const outcomes = JSON.parse(r.outcomes_json) as Array<{ label: string; price: number }>;
      const yes = outcomes.find(o => o.label.toLowerCase() === 'yes') ?? outcomes[0]!;
      return `${i + 1}. ${truncateQuestion(r.question)} — ${yes.label} ${fmtPrice(yes.price)} — ${fmtUsd(r.volume_24h)}\n   /poly market ${r.slug}`;
    }),
  ).join('\n');
}

async function renderMarket(db: Database.Database, slug: string): Promise<string> {
  if (!slug) return 'Usage: /poly market <slug>';
  const row = db.prepare(`SELECT * FROM poly_markets WHERE slug = ?`).get(slug) as
    | { slug: string; question: string; category: string | null; outcomes_json: string; volume_24h: number; liquidity: number; end_date: number }
    | undefined;
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
    lines.push(
      `  Best bid/ask: ${topBids[0] ? fmtPrice(topBids[0].price) : '—'} / ${topAsks[0] ? fmtPrice(topAsks[0].price) : '—'}`,
    );
  }
  return lines.join('\n');
}

function renderTrending(db: Database.Database): string {
  const markets = db.prepare(
    `SELECT slug, question, outcomes_json FROM poly_markets WHERE closed=0 LIMIT 200`,
  ).all() as Array<{ slug: string; question: string; outcomes_json: string }>;
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
    scored.slice(0, 10).map((s, i) =>
      `${i + 1}. ${truncateQuestion(s.question)} — ${fmtPrice(s.now)} (${s.delta >= 0 ? '+' : ''}${(s.delta * 100).toFixed(1)}pp)`,
    ),
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
  return ['Markets resolving in next 24h (≥$10k vol):', ''].concat(
    rows.map(r => {
      const hrs = ((r.end_date - now) / 3600).toFixed(1);
      return `${truncateQuestion(r.question)} — closes in ${hrs}h — ${fmtUsd(r.volume_24h)} vol`;
    }),
  ).join('\n');
}

function renderStatus(db: Database.Database): string {
  const latest = db.prepare(`SELECT MAX(last_scan_at) AS t FROM poly_markets`).get() as { t: number | null };
  const marketCount = db.prepare(`SELECT COUNT(*) AS c FROM poly_markets WHERE closed=0`).get() as { c: number };
  const sigCounts = db.prepare(`
    SELECT SUM(approved=1) AS a, SUM(approved=0) AS r
    FROM poly_signals WHERE created_at >= ?
  `).get(Math.floor(Date.now() / 1000) - 86400) as { a: number | null; r: number | null };

  // poly_kv is created by initPoly + StrategyEngine; guard in case a caller
  // reads status before either has run.
  let halt: { value: string } | undefined;
  try {
    halt = db.prepare(`SELECT value FROM poly_kv WHERE key='poly.halt'`).get() as { value: string } | undefined;
  } catch {
    halt = undefined;
  }

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

interface SignalRow {
  id: number;
  created_at: number;
  market_slug: string;
  outcome_label: string;
  market_price: number;
  estimated_prob: number;
  edge_pct: number;
  approved: number;
  paper_trade_id: number | null;
  rejection_reasons: string | null;
}

export function renderSignals(db: Database.Database): string {
  const rows = db.prepare(`
    SELECT id, created_at, market_slug, outcome_label, market_price,
           estimated_prob, edge_pct, approved, paper_trade_id, rejection_reasons
      FROM poly_signals ORDER BY id DESC LIMIT 10
  `).all() as SignalRow[];
  if (rows.length === 0) return 'No signals yet. Strategy engine runs after each scan.';
  const lines: string[] = ['Last 10 signals:', ''];
  for (const r of rows) {
    const icon = r.approved ? '✅' : '⚠️';
    const ageMin = Math.floor((Date.now() / 1000 - r.created_at) / 60);
    const tail = r.approved
      ? `trade #${r.paper_trade_id ?? '—'}`
      : (firstGate(r.rejection_reasons) ?? 'rejected');
    lines.push(
      `${icon} ${ageMin}m  ${truncateQuestion(r.market_slug, 40)} ${r.outcome_label}` +
      `  ask ${(r.market_price * 100).toFixed(1)}¢ · p̂ ${(r.estimated_prob * 100).toFixed(0)}% · edge ${edgeStr(r.edge_pct)}` +
      `  ${tail}`,
    );
  }
  return lines.join('\n');
}

function firstGate(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Array<{ gate?: string; reason?: string }>;
    return parsed[0] ? `${parsed[0].gate}: ${parsed[0].reason}` : null;
  } catch { return null; }
}

function edgeStr(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + 'pp';
}

interface PositionRow {
  trade_id: number;
  market_slug: string;
  outcome_label: string;
  entry_price: number;
  shares: number;
  size_usd: number;
  current_price: number | null;
  unrealized_pnl: number | null;
}

export function renderPositions(db: Database.Database): string {
  const rows = db.prepare(`
    SELECT t.id AS trade_id, t.market_slug, t.outcome_label, t.entry_price,
           t.shares, t.size_usd, p.current_price, p.unrealized_pnl
      FROM poly_paper_trades t
      LEFT JOIN poly_positions p ON p.paper_trade_id = t.id
     WHERE t.status = 'open'
     ORDER BY t.id DESC
  `).all() as PositionRow[];
  if (rows.length === 0) return 'No open positions.';
  const lines: string[] = [`Open paper positions (${rows.length}):`, ''];
  let totalCost = 0;
  let totalUnrealized = 0;
  for (const r of rows) {
    totalCost += r.size_usd;
    totalUnrealized += r.unrealized_pnl ?? 0;
    const price = r.current_price ?? r.entry_price;
    lines.push(
      `#${r.trade_id}  ${truncateQuestion(r.market_slug, 40)} ${r.outcome_label}` +
      `  ${r.shares.toFixed(2)} sh @ ${fmtPrice(r.entry_price)}` +
      ` → ${fmtPrice(price)}  u/r ${signedUsd(r.unrealized_pnl ?? 0)}`,
    );
  }
  lines.push('', `Deployed: ${fmtUsd(totalCost)}  Unrealized: ${signedUsd(totalUnrealized)}`);
  return lines.join('\n');
}

function signedUsd(n: number): string {
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}

export function renderPnl(db: Database.Database): string {
  const realized = db.prepare(`
    SELECT status, COUNT(*) AS n, COALESCE(SUM(realized_pnl), 0) AS total
      FROM poly_paper_trades
     WHERE status IN ('won','lost','voided')
     GROUP BY status
  `).all() as Array<{ status: string; n: number; total: number }>;

  const unrealizedRow = db.prepare(`
    SELECT COALESCE(SUM(p.unrealized_pnl), 0) AS total
      FROM poly_positions p
      INNER JOIN poly_paper_trades t ON t.id = p.paper_trade_id
     WHERE t.status = 'open'
  `).get() as { total: number };

  const openRow = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(size_usd), 0) AS deployed
       FROM poly_paper_trades WHERE status='open'`,
  ).get() as { n: number; deployed: number };

  const dailyPnl = getDailyRealizedPnl(db);

  const won = realized.find(r => r.status === 'won') ?? { n: 0, total: 0 };
  const lost = realized.find(r => r.status === 'lost') ?? { n: 0, total: 0 };
  const voided = realized.find(r => r.status === 'voided') ?? { n: 0, total: 0 };

  const totalRealized = won.total + lost.total + voided.total;
  const settled = won.n + lost.n;
  const winRate = settled > 0 ? (won.n / settled) * 100 : 0;
  const equity = POLY_PAPER_CAPITAL + totalRealized + unrealizedRow.total;
  const ddPct = POLY_PAPER_CAPITAL > 0
    ? Math.max(0, (POLY_PAPER_CAPITAL - equity) / POLY_PAPER_CAPITAL) * 100
    : 0;

  return [
    'Paper P&L',
    `Capital: ${fmtUsd(POLY_PAPER_CAPITAL)}  Equity: ${fmtUsd(equity)}  DD: ${ddPct.toFixed(1)}%`,
    `Today realized: ${signedUsd(dailyPnl)}`,
    `Lifetime realized: ${signedUsd(totalRealized)}  (won ${won.n} · lost ${lost.n} · void ${voided.n}` +
      (settled > 0 ? `  · win rate ${winRate.toFixed(0)}%` : '') + ')',
    `Open: ${openRow.n}  Deployed: ${fmtUsd(openRow.deployed)}  Unrealized: ${signedUsd(unrealizedRow.total)}`,
  ].join('\n');
}

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
  // Per-regime Brier (Sprint 3): shows whether the strategy miscalibrates
  // in specific macro regimes. Empty when the calibration snapshot was
  // taken before any regime-tagged signals had resolved.
  if (snap.byRegime.length > 0) {
    lines.push('', 'Brier by regime:');
    for (const r of snap.byRegime.slice(0, 5)) {
      const brier = r.brierScore === null ? 'n/a' : r.brierScore.toFixed(3);
      lines.push(`  ${r.regime}: n=${r.nSamples} Brier=${brier}`);
    }
  }
  return lines.join('\n');
}

export function renderDrift(db: Database.Database): string {
  try {
    const report = composeDriftReport(db, Math.floor(Date.now() / 1000), 24);
    return formatDriftReport(report);
  } catch {
    return 'Drift metrics unavailable — poly_scan_runs table may not exist. Run: npm run migrate';
  }
}

export function renderResearch(db: Database.Database): string {
  let rows: ReturnType<typeof latestResearchItems>;
  try {
    rows = latestResearchItems(db, 10);
  } catch {
    // research_items table may not exist on pre-v1.6.0 installs.
    return 'No research ingested yet. Run: npx tsx scripts/research-ingest.ts';
  }
  if (rows.length === 0) return 'No research ingested yet. Run: npx tsx scripts/research-ingest.ts';
  const lines: string[] = [`Latest ${rows.length} research items:`, ''];
  const nowSec = Math.floor(Date.now() / 1000);
  for (const r of rows) {
    const ageHrs = Math.max(0, Math.round((nowSec - r.fetchedAt) / 3600));
    const ageStr = ageHrs < 24 ? `${ageHrs}h` : `${Math.round(ageHrs / 24)}d`;
    lines.push(`${ageStr}  [${r.source}] ${truncateQuestion(r.title, 70)}`);
  }
  return lines.join('\n');
}

export function renderRegime(db: Database.Database): string {
  const snap = latestRegimeSnapshot(db);
  if (!snap) return 'No regime snapshot yet. Refresh fires every POLY_REGIME_REFRESH_MIN inside the scanner tick.';
  const ageMin = Math.round((Math.floor(Date.now() / 1000) - snap.createdAt) / 60);
  const fmt = (n: number | null, d = 2): string => n === null ? 'n/a' : n.toFixed(d);
  return [
    `Latest regime: ${snap.regimeLabel}  (age ${ageMin}m)`,
    `VIX: ${fmt(snap.vix)}  BTC dominance: ${fmt(snap.btcDominance)}%  10y yield: ${fmt(snap.yield10y)}%`,
  ].join('\n');
}

export function renderReflect(db: Database.Database): string {
  // Count recent shadow signals and their largest pair-shifts vs primary.
  // Pull last 20 (slug, tokenId) combos where both v3 and v3-reflect wrote
  // rows since bot start.
  const pairs = db.prepare(`
    SELECT p.market_slug AS slug, p.outcome_token_id AS tok,
           p.estimated_prob AS primary_p, s.estimated_prob AS shadow_p,
           p.created_at AS ts
      FROM poly_signals p
      INNER JOIN poly_signals s
         ON s.market_slug = p.market_slug
        AND s.outcome_token_id = p.outcome_token_id
        AND s.prompt_version = 'v3-reflect'
        AND s.id > p.id
        AND s.id < p.id + 10
     WHERE p.prompt_version = 'v3'
     ORDER BY p.id DESC LIMIT 20
  `).all() as Array<{ slug: string; tok: string; primary_p: number; shadow_p: number; ts: number }>;

  const header = `Reflection pass (Sprint 2.5) — enabled=${POLY_REFLECTION_ENABLED}`;
  if (pairs.length === 0) {
    return [
      header,
      POLY_REFLECTION_ENABLED
        ? 'No reflection pairs yet. Wait one scan cycle.'
        : 'Set POLY_REFLECTION_ENABLED=true in .env and restart pm2 to start shadow-logging v3-reflect.',
    ].join('\n');
  }

  const shifts = pairs.map(p => ({
    slug: p.slug,
    shift: p.shadow_p - p.primary_p,
    primary: p.primary_p,
    shadow: p.shadow_p,
  }));
  shifts.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift));
  const meanAbsShift = shifts.reduce((s, x) => s + Math.abs(x.shift), 0) / shifts.length;

  const cmp = compareStrategiesOnResolutions(db, 'v3', 'v3-reflect');
  const brierLine = cmp.nPaired === 0
    ? 'A/B Brier: no resolved markets yet.'
    : `A/B Brier on ${cmp.nPaired} resolved markets: v3=${(cmp.brierA ?? 0).toFixed(4)}, v3-reflect=${(cmp.brierB ?? 0).toFixed(4)}, winner=${cmp.winner}${cmp.tTest.pValue < 0.05 ? ` (p=${cmp.tTest.pValue.toFixed(3)})` : ''}`;

  const top = shifts.slice(0, 5).map(s =>
    `  ${truncateQuestion(s.slug, 40)}: ${s.primary.toFixed(3)} → ${s.shadow.toFixed(3)} (${s.shift >= 0 ? '+' : ''}${(s.shift * 100).toFixed(1)}pp)`,
  );

  return [
    header,
    `Pairs sampled: ${pairs.length}. Mean |shift|: ${(meanAbsShift * 100).toFixed(1)}pp.`,
    brierLine,
    '',
    'Largest shifts (recent):',
    ...top,
  ].join('\n');
}

const HALT_KEY = 'poly.halt';

function writeHaltFlag(db: Database.Database, value: '0' | '1'): void {
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(HALT_KEY, value);
}

export function setHalt(db: Database.Database): string {
  writeHaltFlag(db, '1');
  return [
    'Halt SET (poly.halt=1).',
    'Strategy engine will short-circuit on the next tick (within ~5 min). No new signals or trades.',
    'Open positions remain open and PnlTracker keeps marking them.',
    'Use /poly resume to clear, /poly status to check.',
  ].join('\n');
}

export function clearHalt(db: Database.Database): string {
  writeHaltFlag(db, '0');
  return [
    'Halt cleared (poly.halt=0).',
    'Strategy engine will resume evaluation on the next tick (within ~5 min).',
  ].join('\n');
}
