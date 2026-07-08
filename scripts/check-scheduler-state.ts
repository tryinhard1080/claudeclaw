import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';
import {
  formatOverdueSummaryLines,
  formatScheduledTaskLines,
  type ScheduledTaskStatus,
} from '../src/readiness/scheduler-status.js';

const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'), { readonly: true });
const now = Math.floor(Date.now() / 1000);
const summaryOnly = process.argv.includes('--summary');
console.log('now =', new Date(now * 1000).toISOString());

type Col = { name: string };
const cols = db.prepare(`PRAGMA table_info(scheduled_tasks)`).all() as Col[];
if (!summaryOnly) console.log('\nscheduled_tasks columns:', cols.map(c => c.name).join(', '));

const tasks = db
  .prepare(`SELECT * FROM scheduled_tasks ORDER BY next_run ASC`)
  .all() as ScheduledTaskStatus[];
console.log(`\n${tasks.length} scheduled tasks total:`);

for (const line of formatOverdueSummaryLines(tasks, now)) console.log(line);

const visibleTasks = summaryOnly
  ? tasks.filter(t => t.agent_id === 'main')
  : tasks;

for (const t of visibleTasks) {
  for (const line of formatScheduledTaskLines(t, now, { includeLastResult: !summaryOnly })) console.log(line);
}

if (summaryOnly) {
  const hiddenNonMain = tasks.length - visibleTasks.length;
  if (hiddenNonMain > 0) {
    console.log(`  (${hiddenNonMain} non-main task detail row(s) hidden; run scheduler:status:full for all agents)`);
  }
}

if (summaryOnly) {
  db.close();
  process.exit(0);
}

const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all() as Col[];
console.log('\nmission_tasks columns:', missionCols.map(c => c.name).join(', '));
const missionColNames = new Set(missionCols.map(c => c.name));
const missionAgentExpr = missionColNames.has('agent_id')
  ? 'agent_id'
  : missionColNames.has('assigned_agent')
    ? 'assigned_agent AS agent_id'
    : "'-' AS agent_id";
const missions = db.prepare(`SELECT id, ${missionAgentExpr}, status, title, created_at FROM mission_tasks ORDER BY id DESC LIMIT 10`).all() as Array<Record<string, unknown>>;
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
