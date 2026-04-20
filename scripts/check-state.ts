import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'), { readonly: true });
const now = Math.floor(Date.now() / 1000);
console.log('now =', new Date(now * 1000).toISOString());
console.log();

const recent = db
  .prepare('SELECT id, created_at, market_slug, approved, provider, model, reasoning FROM poly_signals ORDER BY id DESC LIMIT 6')
  .all() as Array<{
    id: number;
    created_at: number;
    market_slug: string;
    approved: number;
    provider: string | null;
    model: string | null;
    reasoning: string;
  }>;
console.log('Last 6 signals:');
for (const r of recent) {
  const age = Math.floor((now - r.created_at) / 60);
  console.log(`  id=${r.id} age=${age}m approved=${r.approved} provider=${r.provider ?? '-'} model=${(r.model ?? '-').slice(0, 20)} slug=${r.market_slug.slice(0, 45)}`);
}
console.log();

const scans = db
  .prepare('SELECT started_at, duration_ms, market_count, status, error FROM poly_scan_runs ORDER BY id DESC LIMIT 6')
  .all() as Array<{
    started_at: number;
    duration_ms: number | null;
    market_count: number | null;
    status: string;
    error: string | null;
  }>;
console.log('Last 6 scan runs:');
for (const s of scans) {
  const age = Math.floor((now - s.started_at) / 60);
  console.log(`  age=${age}m duration=${s.duration_ms ?? '-'}ms markets=${s.market_count ?? '-'} status=${s.status}${s.error ? ' error=' + s.error.slice(0, 80) : ''}`);
}

db.close();
