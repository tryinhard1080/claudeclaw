import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Add poly_news_position_alerts table for Sprint 21 news-intersection Telegram alerts';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * Sprint 21 (plan §4): a single news_item × open paper-trade pair only
 * alerts the operator once. PRIMARY KEY (news_item_id, paper_trade_id)
 * makes INSERT OR IGNORE the dispatch gate — `db.changes() === 1` means
 * a fresh emission, `=== 0` means we already alerted this pair.
 *
 * matched_tokens captures which slug tokens hit in the news summary,
 * so a retro can audit whether the matching rule needs tightening
 * (e.g. always tripped on the same generic word).
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poly_news_position_alerts (
        news_item_id   INTEGER NOT NULL,
        paper_trade_id INTEGER NOT NULL,
        matched_tokens TEXT NOT NULL,
        emitted_at     INTEGER NOT NULL,
        PRIMARY KEY (news_item_id, paper_trade_id)
      );
      CREATE INDEX IF NOT EXISTS idx_news_alerts_emitted
        ON poly_news_position_alerts(emitted_at DESC);
    `);
  } finally {
    db.close();
  }
}
