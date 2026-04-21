import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { STORE_DIR } from '../src/config.js';

const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
const walPath = dbPath + '-wal';
const shmPath = dbPath + '-shm';

for (const p of [dbPath, walPath, shmPath]) {
  try {
    const s = fs.statSync(p);
    console.log(`${path.basename(p).padEnd(22)} ${(s.size / 1024 / 1024 / 1024).toFixed(3)} GB  mtime=${s.mtime.toISOString()}`);
  } catch {
    console.log(`${path.basename(p).padEnd(22)} missing`);
  }
}
console.log();

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all() as Array<{ name: string }>;

type Row = { n: number };
console.log('Row counts (top 15 by size):');
const rows = tables.map(t => {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as Row;
    return { table: t.name, n: r.n };
  } catch (e) {
    return { table: t.name, n: -1 };
  }
});
rows.sort((a, b) => b.n - a.n);
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.table.padEnd(36)} ${r.n.toLocaleString()} rows`);
}
console.log();

const priceMinMax = db
  .prepare(`SELECT MIN(captured_at) AS mn, MAX(captured_at) AS mx, COUNT(*) AS c FROM poly_price_history`)
  .get() as { mn: number | null; mx: number | null; c: number };
if (priceMinMax.c > 0) {
  const now = Math.floor(Date.now() / 1000);
  console.log(
    `poly_price_history: oldest=${priceMinMax.mn ? new Date(priceMinMax.mn * 1000).toISOString() : '-'} (${priceMinMax.mn ? Math.floor((now - priceMinMax.mn) / 3600) : '-'}h ago), newest=${priceMinMax.mx ? new Date(priceMinMax.mx * 1000).toISOString() : '-'}, count=${priceMinMax.c.toLocaleString()}`,
  );
  const cutoff = now - 36 * 3600;
  const older = db
    .prepare(`SELECT COUNT(*) AS n FROM poly_price_history WHERE captured_at < ?`)
    .get(cutoff) as Row;
  console.log(`  rows older than 36h (pruneOldPrices target): ${older.n.toLocaleString()}`);
}

const idx = db
  .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='poly_price_history'`)
  .all() as Array<{ name: string; sql: string | null }>;
console.log(`\npoly_price_history indexes:`);
for (const i of idx) console.log(`  ${i.name}: ${i.sql ?? '(auto)'}`);
const pragma = db.prepare(`PRAGMA table_info(poly_price_history)`).all();
console.log(`  columns:`, pragma);

db.close();
