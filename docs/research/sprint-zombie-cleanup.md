# Sprint zombie-cleanup — drop orphaned PA tables (v1.12.0) [audit]

## 1. Existing-code audit

Explore agent pass on 2026-04-20 confirmed:
- `wa_messages`, `wa_outbox`, `wa_message_map`, `slack_messages`:
  zero references in any `.ts` file under `src/`. Safe to drop.

Not dropped (still live):
- `consolidations` — read by memory.ts, dashboard.ts, dashboard-html.ts
- `hive_mind` — read by orchestrator.ts, memory.ts, dashboard.ts
- `inter_agent_tasks` — read by dashboard.ts
- `mission_tasks` — read by dashboard.ts + db.ts helpers

These 4 were kept by the 2026-04-13 phase 4b PA-strip because dashboard
still depends on them. A future phase 4c will refactor dashboard to
drop them; this sprint is just the clearly-unused ones.

## 2. Literature / NotebookLM finding

Not applicable — schema hygiene, not research.

## 3. Duplicate / complement / conflict verdict

**Complement** to the 2026-04-13 phase 4b commit that stripped the TS
code for WhatsApp + Slack. This is the DB-side completion of that work.

## 4. Why now

- Part A's VACUUM (separate commit) reclaims freed pages after these
  drops land. Running them in the same maintenance window maximizes
  the space recovered.
- Schema archaeology is cleaner if `sqlite_master` doesn't show 4
  zombie tables.

## 5. Out of scope

- Dropping `consolidations` / `hive_mind` / `inter_agent_tasks` /
  `mission_tasks`. Those need a dashboard refactor first.
- Dropping columns from tables we're keeping.

## 6. Risk

- If a bug in the PA-strip accidentally left a code path writing to
  `wa_messages`, the next scan would throw "no such table". Mitigated
  by the Explore-agent audit: zero TS references. If the error surfaces
  anyway, the migration is reversible (CREATE TABLE with original
  schema), and the WAL won't checkpoint the DROP until success.

## 7. Verification plan

- After `npm run migrate` applies v1.12.0, run
  `scripts/audit-schema.ts` (Part F) and confirm the 4 tables are gone.
- No errors during first scan after restart.
- Normal bot operation for 24h with no "no such table" errors in pm2
  stderr.
