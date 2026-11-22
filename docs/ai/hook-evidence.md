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

Real Edit tool calls on `db/migrations/001_create_tasks.sql` inside a Claude Code session were blocked by the
PreToolUse hook (tool call never executed). First firing (original hook):

```
PreToolUse:Edit hook error: [node .claude/hooks/protect-migrations.mjs]:
BLOCKED: editing an applied migration is forbidden (db/migrations is immutable once applied).
File: db/migrations/001_create_tasks.sql
Instead, add a NEW numbered migration: db/migrations/<next-number>_<what_it_does>.sql
Follow the add-migration skill: .claude/skills/add-migration/SKILL.md
```

After the code-review fixes (CLAUDE_PROJECT_DIR command + tracked-file semantics), the hook fired again live:

```
PreToolUse:Edit hook error: [node "${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-migrations.mjs"]:
BLOCKED: editing an applied migration is forbidden (db/migrations is immutable once committed).
File: db/migrations/001_create_tasks.sql
...
```

(The new command string appears in the hook's own error label, so the session is running the updated settings.)

## 4. Full test battery (after the code-review fixes)

The hook distinguishes **tracked** (applied) migrations from untracked ones, resolves the project root from
`CLAUDE_PROJECT_DIR` or the script's own location, and fails closed when git errors:

| # | Case | Expected | Got |
|---|---|---|---|
| T1 | relative path, tracked migration | 2 | 2 |
| T2 | new untracked migration (`003_new.sql`) | 0 | 0 |
| T3 | non-migration path (`lib/tasks.ts`) | 0 | 0 |
| T4 | absolute path, tracked migration | 2 | 2 |
| T5 | existing but untracked migration file (`003_tmp.sql`) — fix-in-place allowed | 0 | 0 |
| T6 | foreign cwd + `CLAUDE_PROJECT_DIR` set | 2 | 2 |
| T7 | foreign cwd, no env var (fallback via script location) | 2 | 2 |
| T8 | `CLAUDE_PROJECT_DIR` points at a nonexistent repo (git errors) — fail closed | 2 | 2 |

## Known limits (stated honestly)

- The hook guards Edit/Write/MultiEdit file paths only. Bash routes to the same files are covered by deny rules
  (`sed -i`, redirects) **as a second layer, not exhaustively**: `tee`, `cp`, `perl -pi`, `node scripts/db-reset.mjs`,
  `rm data/tasks.db*`, `git restore db/migrations/...` and `rm db/migrations/<untracked>.sql` are accepted bypasses
  (code review #3). The real backstops are CODEOWNERS review and the L0 rule in the team agreement.
- "Applied" is approximated by "tracked in git". If the git check errors, the hook fails closed (treats the file as
  applied and blocks). Editing a *committed-then-reverted* migration is also blocked — deliberate, since it was applied.
- The `Read(.env.*)` deny rule is deliberately broad: it also blocks `.env.example` (fake values, but the agent has
  no reason to read any dotenv file). Observed side effect: some git commands print a harmless
  `.env.example: Operation not permitted` line in sandboxed sessions — likely because the file-read denial reaches
  git subprocesses too, though that mechanism is not independently confirmed. Narrowing the rule is the owner's
  call, not the agent's.
- If machine-level managed settings allow only managed hooks, the manual run in section 1 is the accepted
  fallback evidence per `docs/ai/hook-test.md` — but on this machine the hook also fired live (section 3).
