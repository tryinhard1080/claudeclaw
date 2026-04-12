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

type Sender = (text: string) => Promise<void>;

interface KvRow { key: string; value: string }

const polyKvGet = (db: Database.Database, key: string): string | null =>
  (db.prepare(`SELECT value FROM poly_kv WHERE key=?`).get(key) as KvRow | undefined)?.value ?? null;

const polyKvSet = (db: Database.Database, key: string, value: string): void => {
  db.prepare(
    `INSERT INTO poly_kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(key, value);
};

export function initPoly(opts: {
  bot: Bot<Context>;
  sender: Sender;
  db: Database.Database;
}): { scanner: MarketScanner; stop: () => void } {
  if (!POLY_ENABLED) {
    logger.info('POLY_ENABLED=false — polymarket module disabled');
    return { scanner: null as unknown as MarketScanner, stop: () => {} };
  }

  // Poly-scoped kv table (no shared `kv` table exists in the DB).
  opts.db.exec(
    `CREATE TABLE IF NOT EXISTS poly_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );

  const scanner = new MarketScanner(opts.db, POLY_SCAN_INTERVAL_MIN * 60_000);
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

  logger.info('Polymarket module initialized');
  return {
    scanner,
    stop: () => {
      scanner.stop();
      clearInterval(digestTimer);
    },
  };
}
