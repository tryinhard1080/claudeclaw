import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../src/config.js';

const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'), { readonly: true });
const q = (label: string, sql: string): void => {
  console.log(label, JSON.stringify(db.prepare(sql).all()));
};

q('total signals', 'SELECT COUNT(*) AS n FROM poly_signals');
q('by approved',   'SELECT approved, COUNT(*) AS n FROM poly_signals GROUP BY approved');
q('by version',    'SELECT prompt_version, COUNT(*) AS n FROM poly_signals GROUP BY prompt_version');
q('confidence',    'SELECT confidence, COUNT(*) AS n FROM poly_signals WHERE approved=1 GROUP BY confidence');
q('trades',        'SELECT status, COUNT(*) AS n FROM poly_paper_trades GROUP BY status');
q('resolutions',   'SELECT COUNT(*) AS n FROM poly_resolutions WHERE closed=1');
q('calib snaps',   'SELECT COUNT(*) AS n FROM poly_calibration_snapshots');
q('edge dist (approved)', `SELECT
  SUM(CASE WHEN edge_pct<2 THEN 1 ELSE 0 END) AS lt2,
  SUM(CASE WHEN edge_pct>=2 AND edge_pct<4 THEN 1 ELSE 0 END) AS b2_4,
  SUM(CASE WHEN edge_pct>=4 AND edge_pct<8 THEN 1 ELSE 0 END) AS b4_8,
  SUM(CASE WHEN edge_pct>=8 THEN 1 ELSE 0 END) AS ge8
  FROM poly_signals`);
q('recent 5 approved', `SELECT created_at, market_slug, market_price, estimated_prob, edge_pct, confidence
  FROM poly_signals WHERE approved=1 ORDER BY id DESC LIMIT 5`);
