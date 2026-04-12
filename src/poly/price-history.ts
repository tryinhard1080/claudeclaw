import type Database from 'better-sqlite3';

export function getPriceApproxHoursAgo(
  db: Database.Database,
  tokenId: string,
  hoursAgo: number,
  toleranceHours = 1,
): number | null {
  const target = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
  const tolSec = toleranceHours * 3600;
  const row = db
    .prepare(
      `SELECT price FROM poly_price_history
       WHERE token_id = ? AND captured_at BETWEEN ? AND ?
       ORDER BY ABS(captured_at - ?) LIMIT 1`,
    )
    .get(tokenId, target - tolSec, target + tolSec, target) as { price: number } | undefined;
  return row?.price ?? null;
}
