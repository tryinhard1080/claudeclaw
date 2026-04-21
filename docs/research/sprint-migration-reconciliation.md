# Sprint migration-reconciliation — schema audit script [audit]

## 1. Existing-code audit

- `migrations/.applied.json` — stores `{ "lastApplied": "v1.X.Y" }`.
- `migrations/version.json` — registry of versions → migration script
  filenames.
- `src/migrations.ts::checkPendingMigrations` — startup guard that
  `process.exit(1)`s if `.applied.json < latest`.
- `src/db.ts::addMissingColumns` — post-init defensive ALTER TABLE
  commands. Historically this is how new columns got added without a
  full migration (e.g., `scheduled_tasks.agent_id`).
- Live DB (per 2026-04-16 handoff notes): tables were created via
  `CREATE TABLE IF NOT EXISTS` in module init rather than purely via
  migration runner. No `schema_migrations` table.

## 2. Literature / NotebookLM finding

Not applicable — this is a build-discipline + audit task.

## 3. Duplicate / complement / conflict verdict

**Complement.** Adds a read-only inspection tool. Does not change
schema or run migrations.

## 4. Why now

Handoff 2026-04-16 flagged migration-tracker reconciliation as a
Sprint 13 candidate ("Do NOT run `npm run migrate` blind"). Part A of
peaceful-turtle needs to run `npm run migrate` to apply v1.10.0 +
v1.11.0 + v1.12.0. Before doing that, we need visibility into what's
actually in the live DB to confirm the migration won't conflict.

`scripts/audit-schema.ts` gives us that visibility. Expected output
for the live DB pre-migrate:

```
Applied: v1.9.0
Latest:  v1.12.0
Known:   v1.2.0, v1.3.0, ..., v1.12.0

Tables (24): ...
  poly_price_history    ~40,000,000 rows  (approximate; was causing
                                           the bloat — to be trimmed
                                           on first post-restart scan)
  ...
Cross-ref against expected schema:
  Unexpected: wa_messages, wa_outbox, wa_message_map, slack_messages
              (will be dropped by v1.12.0)
  Missing:    (none)
```

Post-migrate:
```
Applied: v1.12.0
Unexpected: (none)
```

## 5. Out of scope

- Backfill of missing `schema_migrations` tracking table. If we decide
  one is needed, that's a separate sprint.
- Auto-repair of schema drift. Audit only.

## 6. Risk

None — read-only script that opens the DB with `readonly: true`.

## 7. Verification plan

- Run `npx tsx scripts/audit-schema.ts` before `npm run migrate`. Record
  output.
- Run `npm run migrate` (Part G2).
- Run the audit again. Verify:
  - `Applied: v1.12.0`
  - `Unexpected:` list is empty (zombies dropped).
  - `Missing:` list is empty (all expected tables present).
  - `poly_price_history` has `idx_poly_price_history_captured` index.
