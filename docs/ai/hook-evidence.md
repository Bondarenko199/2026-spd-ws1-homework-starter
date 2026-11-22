<!-- owner: @Bondarenko199 · why: the rubric requires proof the hook blocks a violation with exit 2 and the reason shown · review-by: 2027-02-22 -->

# Hook evidence — `protect-migrations` (PreToolUse, exit 2)

Hook: `.claude/hooks/protect-migrations.mjs`, wired in `.claude/settings.json` with matcher `Edit|Write|MultiEdit`.
Payload used: [`docs/ai/sample-payload.json`](sample-payload.json).

## 1. Manual run (docs/ai/hook-test.md procedure)

```
$ node .claude/hooks/protect-migrations.mjs < docs/ai/sample-payload.json
BLOCKED: editing an applied migration is forbidden (db/migrations is immutable once applied).
File: db/migrations/001_create_tasks.sql
Instead, add a NEW numbered migration: db/migrations/<next-number>_<what_it_does>.sql
Follow the add-migration skill: .claude/skills/add-migration/SKILL.md
$ echo $?
2
```

## 2. Allow cases (manual run, exit 0)

```
$ echo '{ "tool_name": "Write", "tool_input": { "file_path": "db/migrations/003_add_task_priority.sql" } }' | node .claude/hooks/protect-migrations.mjs
$ echo $?          # new migration file -> allowed
0

$ echo '{ "tool_name": "Edit", "tool_input": { "file_path": "lib/tasks.ts" } }' | node .claude/hooks/protect-migrations.mjs
$ echo $?          # non-migration path -> not this hook's concern
0
```

## 3. Live session proof

A real Edit tool call on `db/migrations/001_create_tasks.sql` inside a Claude Code session was blocked by the
PreToolUse hook (tool call never executed):

```
PreToolUse:Edit hook error: [node .claude/hooks/protect-migrations.mjs]:
BLOCKED: editing an applied migration is forbidden (db/migrations is immutable once applied).
File: db/migrations/001_create_tasks.sql
Instead, add a NEW numbered migration: db/migrations/<next-number>_<what_it_does>.sql
Follow the add-migration skill: .claude/skills/add-migration/SKILL.md
```

## Known limits (stated honestly)

- The hook guards Edit/Write/MultiEdit file paths. A `Bash` redirect or `sed -i` on a migration file bypasses it;
  `Bash(sed -i * db/migrations/*)` and `Bash(*> db/migrations/*.sql*)` are additionally **denied** in
  `.claude/settings.json`, and editing an applied migration is L0 in the team agreement.
- The `Read(.env.*)` deny rule is deliberately broad: it also blocks `.env.example` (fake values, but the agent has
  no reason to read any dotenv file). Accepted side effect: some git commands print a harmless
  `.env.example: Operation not permitted` line in sandboxed sessions.
- If machine-level managed settings allow only managed hooks, the manual run in section 1 is the accepted
  fallback evidence per `docs/ai/hook-test.md` — but on this machine the hook also fired live (section 3).
