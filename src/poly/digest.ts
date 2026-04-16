import type Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { POLY_DIGEST_HOUR, POLY_TIMEZONE, POLY_MIN_EDGE_PCT } from '../config.js';
import { fmtUsd, fmtPrice, truncateQuestion } from './format.js';
import { latestRegimeSnapshot } from './regime.js';
import { latestSnapshot as latestCalibrationSnapshot } from './calibration.js';

export interface ShouldRunArgs {
  hour: number;
  timezone: string;
  now: Date;
  lastRunYmd: string | null;
}

export function shouldRunDigest(args: ShouldRunArgs): boolean {
  const dt = DateTime.fromJSDate(args.now).setZone(args.timezone);
  const ymd = dt.toFormat('yyyy-LL-dd');
  return dt.hour >= args.hour && args.lastRunYmd !== ymd;
}

export function composeDigest(db: Database.Database): { text: string; ymd: string } {
  const tzNow = DateTime.now().setZone(POLY_TIMEZONE);
  const ymd = tzNow.toFormat('yyyy-LL-dd');

  const top5 = db.prepare(
    `SELECT slug, question, outcomes_json, volume_24h FROM poly_markets WHERE closed=0 ORDER BY volume_24h DESC LIMIT 5`,
  ).all() as Array<{ slug: string; question: string; outcomes_json: string; volume_24h: number }>;

  const edgeCutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
  const highEdge = db.prepare(`
    SELECT market_slug, outcome_label, market_price, estimated_prob, edge_pct
    FROM poly_signals WHERE approved=1 AND created_at >= ? AND edge_pct >= ?
    ORDER BY edge_pct DESC LIMIT 5
  `).all(edgeCutoff, POLY_MIN_EDGE_PCT) as Array<{
    market_slug: string;
    outcome_label: string;
    market_price: number;
    estimated_prob: number;
    edge_pct: number;
  }>;

  const openCount = (db.prepare(
    `SELECT COUNT(*) AS c FROM poly_paper_trades WHERE status='open'`,
  ).get() as { c: number }).c;

  const dayStart = tzNow.startOf('day').toSeconds();
  const dayPnl = (db.prepare(
    `SELECT COALESCE(SUM(realized_pnl), 0) AS p FROM poly_paper_trades WHERE resolved_at >= ? AND status IN ('won','lost')`,
  ).get(dayStart) as { p: number }).p;

  const regime = latestRegimeSnapshot(db);
  const regimeLine = regime
    ? `Regime: ${regime.regimeLabel} (VIX ${regime.vix?.toFixed(1) ?? '—'}, BTC-dom ${regime.btcDominance?.toFixed(1) ?? '—'}%, 10y ${regime.yield10y?.toFixed(2) ?? '—'}%)`
    : 'Regime: (no data)';

  const calib = latestCalibrationSnapshot(db);
  const calibLine = calib && calib.brierScore !== null
    ? `Calibration: Brier ${calib.brierScore.toFixed(3)}, log-loss ${calib.logLoss?.toFixed(2) ?? '—'}, N=${calib.nSamples}`
    : 'Calibration: (no resolutions yet)';

  const openPositions = db.prepare(
    `SELECT market_slug, outcome_label, entry_price, size_usd
       FROM poly_paper_trades WHERE status='open'
       ORDER BY id ASC LIMIT 10`,
  ).all() as Array<{ market_slug: string; outcome_label: string; entry_price: number; size_usd: number }>;

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
    ...highEdge.map(h => `  • ${truncateQuestion(h.market_slug)} — market ${fmtPrice(h.market_price)}, model ${(h.estimated_prob * 100).toFixed(1)}%, edge +${h.edge_pct.toFixed(1)}%`),
    '',
    regimeLine,
    calibLine,
    '',
    `Open paper positions: ${openCount}  |  Realized P&L today: $${dayPnl.toFixed(2)}`,
    ...openPositions.map((p, i) => `  ${i + 1}. ${truncateQuestion(p.market_slug)} — ${p.outcome_label} @${fmtPrice(p.entry_price)} (${fmtUsd(p.size_usd)})`),
  ].filter(l => l !== '');

  return { text: lines.join('\n'), ymd };
}
