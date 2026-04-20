import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'), { readonly: true });
const now = Math.floor(Date.now() / 1000);
console.log('now =', new Date(now * 1000).toISOString());

type Col = { name: string };
const cols = db.prepare(`PRAGMA table_info(scheduled_tasks)`).all() as Col[];
console.log('\nscheduled_tasks columns:', cols.map(c => c.name).join(', '));

const tasks = db
  .prepare(`SELECT * FROM scheduled_tasks ORDER BY next_run ASC`)
  .all() as Array<Record<string, unknown>>;
console.log(`\n${tasks.length} scheduled tasks total:`);
for (const t of tasks) {
  const next = t.next_run as number | null;
  const last = t.last_run as number | null;
  const status = t.status as string | null;
  const agent = t.agent_id as string | null;
  const id = t.id as string;
  const prompt = (t.prompt as string | null) ?? '';
  const lastErr = t.last_result_text as string | null;
  const nextAge = next ? Math.floor((now - next) / 60) : null;
  const lastAge = last ? Math.floor((now - last) / 60) : null;
  console.log(
    `  id=${id.slice(0, 8)} agent=${agent} status=${status} overdue=${
      nextAge !== null && nextAge > 0 ? `${nextAge}m` : 'no'
    } lastRun=${lastAge !== null ? `${lastAge}m ago` : 'never'} schedule=${t.schedule} prompt="${prompt.slice(0, 50)}"`,
  );
  if (lastErr && lastErr.length > 0) {
    console.log(`    lastResult="${lastErr.slice(0, 120)}"`);
  }
}

const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all() as Col[];
console.log('\nmission_tasks columns:', missionCols.map(c => c.name).join(', '));
const missions = db.prepare(`SELECT id, agent_id, status, title, created_at FROM mission_tasks ORDER BY id DESC LIMIT 10`).all() as Array<Record<string, unknown>>;
console.log(`\nLast 10 mission tasks:`);
for (const m of missions) {
  const age = Math.floor((now - (m.created_at as number)) / 60);
  console.log(`  id=${m.id} age=${age}m status=${m.status} agent=${m.agent_id} title="${String(m.title ?? '').slice(0, 60)}"`);
}

const logCols = db.prepare(`PRAGMA table_info(conversation_log)`).all() as Col[];
console.log('\nconversation_log columns:', logCols.map(c => c.name).join(', '));
const logs = db.prepare(`SELECT created_at, role, substr(content, 1, 120) AS snippet FROM conversation_log ORDER BY created_at DESC LIMIT 10`).all() as Array<Record<string, unknown>>;
console.log(`\nLast 10 conversation_log entries:`);
for (const l of logs) {
  const age = Math.floor((now - (l.created_at as number)) / 60);
  console.log(`  age=${age}m role=${l.role} content="${String(l.snippet ?? '').replace(/\n/g, ' ').slice(0, 110)}"`);
}

db.close();
