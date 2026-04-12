import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { fetchBook } from './clob-client.js';
import { getPriceApproxHoursAgo } from './price-history.js';
import { truncateForTelegram, fmtUsd, fmtPrice, truncateQuestion } from './format.js';

export function registerPolyCommands(bot: Bot<Context>, db: Database.Database): void {
  bot.command('poly', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const parts = text.replace(/^\/poly\s*/, '').trim().split(/\s+/);
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

  // kv table may not exist yet — wrap and default to undefined.
  let halt: { value: string } | undefined;
  try {
    halt = db.prepare(`SELECT value FROM kv WHERE key='poly.halt'`).get() as { value: string } | undefined;
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
