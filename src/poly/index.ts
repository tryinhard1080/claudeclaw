import type { Bot, Context } from 'grammy';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import {
  POLY_ENABLED,
  POLY_SCAN_INTERVAL_MIN,
  POLY_TIMEZONE,
  POLY_DIGEST_HOUR,
} from '../config.js';
import { MarketScanner } from './market-scanner.js';
import { registerPolyCommands } from './telegram-commands.js';
import { composeDigest, shouldRunDigest } from './digest.js';
import { StrategyEngine } from './strategy-engine.js';
import { PnlTracker } from './pnl-tracker.js';
import { registerPolyAlerts } from './alerts.js';

type Sender = (text: string) => Promise<void>;

interface KvRow { key: string; value: string }

const polyKvGet = (db: Database.Database, key: string): string | null =>
  (db.prepare(`SELECT value FROM poly_kv WHERE key=?`).get(key) as KvRow | undefined)?.value ?? null;

const polyKvSet = (db: Database.Database, key: string, value: string): void => {
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(key, value);
};

export interface InitPolyResult {
  scanner: MarketScanner;
  strategyEngine: StrategyEngine | null;
  pnlTracker: PnlTracker | null;
  stop: () => void;
}

export function initPoly(opts: {
  bot: Bot<Context>;
  sender: Sender;
  db: Database.Database;
}): InitPolyResult {
  if (!POLY_ENABLED) {
    logger.info('POLY_ENABLED=false — polymarket module disabled');
    return {
      scanner: null as unknown as MarketScanner,
      strategyEngine: null, pnlTracker: null,
      stop: () => {},
    };
  }

  // Poly-scoped kv table (no shared `kv` table exists in the DB).
  opts.db.exec(
    `CREATE TABLE IF NOT EXISTS poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );

  const scanner = new MarketScanner(opts.db, POLY_SCAN_INTERVAL_MIN * 60_000);

  // Phase C: strategy engine + P&L tracker + alerts. Engine subscribes to
  // scanner `scan_complete` in its constructor, so it must be built BEFORE
  // scanner.start() to avoid missing the first tick.
  const strategyEngine = new StrategyEngine({ db: opts.db, scanner });
  const pnlTracker = new PnlTracker(opts.db);
  registerPolyAlerts({ strategyEngine, pnlTracker, sender: opts.sender });
  pnlTracker.start();
  scanner.start();
  registerPolyCommands(opts.bot, opts.db);

  // Digest tick — every 5 minutes, fires at most once per target-tz day.
  const digestTimer = setInterval(() => {
    try {
      const lastYmd = polyKvGet(opts.db, 'poly.last_digest_ymd');
      if (
        shouldRunDigest({
          hour: POLY_DIGEST_HOUR,
          timezone: POLY_TIMEZONE,
          now: new Date(),
          lastRunYmd: lastYmd,
        })
      ) {
        const { text, ymd } = composeDigest(opts.db);
        void opts
          .sender(text)
          .then(() => polyKvSet(opts.db, 'poly.last_digest_ymd', ymd));
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'digest tick failed');
    }
  }, 5 * 60_000);

  logger.info('Polymarket module initialized (Phase C: scanner + strategy + pnl tracker)');
  return {
    scanner,
    strategyEngine,
    pnlTracker,
    stop: () => {
      scanner.stop();
      pnlTracker.stop();
      clearInterval(digestTimer);
    },
  };
}
