import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../src/config.js';

export const description =
  'Drop WhatsApp + Slack tables from the 2026-04-13 PA-strip phase 4b';

export async function run(): Promise<void> {
  return runAt(path.join(STORE_DIR, 'claudeclaw.db'));
}

/**
 * 2026-04-13 phase 4b stripped the WhatsApp + Slack personal-assistant
 * modules (see project_audit_remediation_2026-04-15). The TS code paths
 * are gone, but the tables survived because no migration dropped them.
 * They're not part of any live code path (verified by Explore agent
 * grep on 2026-04-20). Drop them to reclaim pages and eliminate
 * cognitive load when reading the schema.
 *
 * Intentionally NOT dropped (still referenced by live code):
 *   - consolidations, hive_mind, inter_agent_tasks, mission_tasks
 *   These are read by dashboard + memory subsystems. A future PA-strip
 *   phase 4c should refactor those consumers first.
 */
export async function runAt(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  try {
    db.exec(`
      DROP TABLE IF EXISTS wa_messages;
      DROP TABLE IF EXISTS wa_outbox;
      DROP TABLE IF EXISTS wa_message_map;
      DROP TABLE IF EXISTS slack_messages;
    `);
  } finally {
    db.close();
  }
}
