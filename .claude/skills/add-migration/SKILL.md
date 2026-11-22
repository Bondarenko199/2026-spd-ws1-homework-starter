---
name: add-migration
description: Add a new SQLite schema migration to this repo the safe way - new numbered file, fresh-DB verification, rollback note. Use whenever a schema change is needed (new column, new table, index).
---

<!-- owner: @Bondarenko199 · why: schema changes broke a fresh clone once; this procedure makes every migration reproducible from zero · review-by: 2027-02-22 -->

# Add a migration

1. **Never edit an existing `db/migrations/*.sql`** — they are immutable once applied (a hook enforces this).
2. Find the next number: `ls db/migrations/` and take the highest `0NN` prefix + 1.
3. Create `db/migrations/<NNN>_<what_it_does>.sql` — filename states the change (`003_add_task_priority.sql`).
   Plain SQL only; SQLite dialect; one concern per file. Constraints go in the SQL (`check`, `not null`, defaults)
   so the DB itself enforces them, not just `lib/tasks.ts`.
4. **If the change touches `lib/tasks.ts` mapping or validation, update it and its tests in the same PR.**
5. Verify from a clean state — this is the check that makes the migration trustworthy:
   ```bash
   npm run db:reset   # deletes data/tasks.db
   npm test           # migrations re-run on a fresh DB inside the tests
   npm run typecheck
   ```
   All three must be green. A migration that only works on an existing DB is a failed migration.
6. If the SQL is destructive (`drop table`, `delete` without `where`, column drops), add a rollback note to the PR
   description: how to restore the previous state.
7. Mention the new file in the PR body so the reviewer sees it is a *new* migration, not an edit.

Check: a fresh clone (`rm -rf data && npm test`) reproduces the whole schema from the migration files alone.
