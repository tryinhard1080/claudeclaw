# Trading Drill Log

## 2026-05-09 Operational Readiness Drills

Environment:

- Worktree: `C:\Users\Richard\.config\superpowers\worktrees\claudeclaw\trading-operational-readiness`
- Store: `C:\claudeclaw-store`
- Date: Saturday, 2026-05-09
- Live-capital status: not enabled

### Halt/Resume Drill

Command:

```powershell
$env:STORE_DIR='C:\claudeclaw-store'; npx tsx scripts/drill-halt-resume.ts
```

Result: PASS

Key output:

```text
start:        2026-05-09T14:28:06.276Z
pre halt:     0
pre open:     10
after set:    1
after clear:  0
end:          2026-05-09T14:28:10.296Z
post open:    10  (delta from pre: 0)
```

Notes:

- `poly.halt` was set to `1` and then cleared to `0`.
- Open paper positions did not change.
- No PM2 restart was performed.

### DB Restore Drill

Command:

```powershell
$env:STORE_DIR='C:\claudeclaw-store'; npx tsx scripts/drill-db-restore.ts
```

Result: PASS

Key output:

```text
start:          2026-05-09T14:28:16.060Z
source backup:  C:\claudeclaw-store\backup-2026-05-09
sha256 verify:  OK (d3917d207a8a664a...)
tables:         29
poly_paper_trades        31
poly_signals             35935
poly_resolutions         79
poly_scan_runs           5809
poly_kv                  5
open=10  won=0  lost=0
end:            2026-05-09T14:28:16.429Z
```

Notes:

- Backup hash matched the recorded SHA256 file.
- Copy hash matched the source backup.
- Restored DB was opened read-only from a scratch temp directory.
- Live DB was not restored over or replaced.

### DB Bloat Check

Command:

```powershell
$env:STORE_DIR='C:\claudeclaw-store'; npx tsx scripts/check-db-bloat.ts
```

Result: PASS

Key output:

```text
claudeclaw.db          0.194 GB
claudeclaw.db-wal      0.009 GB
claudeclaw.db-shm      0.000 GB
poly_markets                         175,862 rows
poly_eval_cache                      81,781 rows
poly_signals                         36,072 rows
poly_scan_runs                       5,829 rows
poly_price_history                   840 rows
poly_price_history oldest=2026-05-09T12:51:29.000Z, newest=2026-05-09T14:25:52.000Z
rows older than 36h: 0
```

Notes:

- DB and WAL sizes were within practical operating range.
- Price history pruning target is working: zero rows older than 36 hours.

### Remaining Drill Gate

The Monday market-open drill cannot be completed on Saturday, 2026-05-09. First eligible window is Monday, 2026-05-11 at 8:20 AM Central / 9:20 AM Eastern, following [`market-open-drill.md`](market-open-drill.md).
