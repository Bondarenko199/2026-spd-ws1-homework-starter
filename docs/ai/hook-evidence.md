<!-- owner: @Bondarenko199 · why: the rubric requires proof the hook blocks a violation with exit 2 and the reason shown · review-by: 2027-02-22 -->

# Hook evidence — `protect-migrations` (PreToolUse, exit 2)

Hook: `.claude/hooks/protect-migrations.mjs`, wired in `.claude/settings.json` with matcher `Edit|Write|MultiEdit|Bash`.
Payload used: [`docs/ai/sample-payload.json`](sample-payload.json).

**Reproducible battery:** `node docs/ai/hook-battery.mjs` runs all cases below (B/A/W/BOM + T-series + T8 fail-closed)
against the current hook and prints PASS/FAIL per case. It is the source of truth for the "Got" columns; the
symlink cases (T10–T13) need a temp repo with symlinks and stay manual (commands in the table).

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
| T7 | foreign cwd, no env var (fallback via script location, `env -u`) | 2 | 2 |
| T8 | `CLAUDE_PROJECT_DIR` points at a nonexistent repo (git errors) — fail closed | 2 | 2 |
| T9 | repo at a path with a space, reached via a symlink alias (`/tmp` → `/private/tmp`), foreign cwd, no env var — Codex PR finding | 2 | 2 (was 0 before the fix: root and target canonicalized with `realpath`, script location via `fileURLToPath`) |
| T10 | symlinked directory inside the repo (`migration-link → db/migrations`) used to reach a tracked migration — Codex PR finding 2 | 2 | 2 |
| T11 | symlinked file inside the repo (`alias-001.sql → db/migrations/001_create_tasks.sql`) | 2 | 2 |
| T12 | brand-new file under the symlinked directory (untracked) — must stay allowed | 0 | 0 |
| T13 | tracked migration deleted from the working tree but still in git, written via the symlinked directory (nearest-existing-ancestor canonicalization) | 2 | 2 (was 0 before the `canonical()` ancestor walk — found by testing, not in the Codex report) |
| T14 | fully nonexistent path (`/nonexistent/a/b.sql`) — must exit 0 without hanging | 0 | 0 |
| T15 | case-variant directory: `DB/Migrations/001_create_tasks.sql` (same file on case-insensitive FS) — instructor finding | 2 | 2 (was 0 before `realpathSync.native` + case-insensitive classification) |
| T16 | uppercase extension: `db/migrations/001_create_tasks.SQL` | 2 | 2 (was 0) |
| T17 | both variants: `DB/Migrations/001_create_tasks.SQL` | 2 | 2 (was 0) |
| T18 | new untracked `DB/Migrations/003_new.sql` — case-variant path must stay allowed for new files | 0 | 0 |
| T19 | tracked file deleted, case-variant path (`DB/Migrations/...`) — tail keeps caller's case, so git lookup matches case-insensitively | 2 | 2 |
| T20 | tracked file deleted, correct-case path — regression guard for T19 | 2 | 2 |

Second-round instructor review (2026-11-25, lost rubric point): Bash-route gaps, Windows separators, BOM fail-open.

| # | Case | Expected | Got |
|---|---|---|---|
| B1 | `echo x>db/migrations/001_…sql` (no space after `>`) — instructor's exact case | 2 | 2 (was 0: deny glob needed a space) |
| B2 | `echo x>>db/migrations/001_…sql` (no space) | 2 | 2 (was 0) |
| B3 | `cd db/migrations && sed -i 's/120/200/' 001_…sql` — relative after cd | 2 | 2 (was 0) |
| B4 | spaced redirect `echo x >> db/migrations/…` | 2 | 2 |
| B5 | full-path `sed -i … /abs/db/migrations/001_…sql` | 2 | 2 |
| B6 | case-variant redirect `echo x > DB/Migrations/001_…sql` | 2 | 2 |
| B7 | `echo x \| tee db/migrations/001_…sql` | 2 | 2 |
| B8 | `git restore db/migrations/001_…sql` | 2 | 2 |
| B9 | `rm db/migrations/001_…sql` | 2 | 2 |
| A1–A9 | read-only routes stay allowed: cat, ls, `git diff -- db/migrations`, `npm test`, `git log -- db/migrations`, grep, `2>/dev/null`, commit message mentioning migrations | 0 | 0 |
| A5 | redirect to a NEW untracked `003_…sql` stays allowed (same semantics as Write) | 0 | 0 |
| W1 | Windows-style backslash path payload (`…\db\migrations\001_…sql`) | 2 | 2 (was 0 on Windows per instructor: `git ls-files` prints forward slashes; `rel` normalized before comparison) |
| BOM | payload with leading UTF-8 BOM — parsed and blocked | 2 | 2 (was 0: JSON.parse threw, hook failed open) |

## Known limits (stated honestly)

- The hook guards Edit/Write/MultiEdit/Bash. The Bash branch resolves migration-file arguments from the command
  text and blocks when a referenced file is tracked (same tracked/case/symlink logic as the file route), or fails
  closed when a write verb plus a migrations reference cannot be resolved. Residual Bash gaps: obfuscated routes
  (variables, wildcards like `rm db/migratio*`, subshells building the path) can still slip past the argument
  extraction — the fail-closed fallback catches some but not all. The real backstops are CODEOWNERS review and
  the L0 rule in the team agreement.
- The `Bash(sed -i*migrations*)` deny rule is a cheap backstop on top of the hook; redirect-to-/dev/null and other
  read-only redirects are not treated as writes.
- "Applied" is approximated by "tracked in git". If the git check errors, the hook fails closed (treats the file as
  applied and blocks). Editing a *committed-then-reverted* migration is also blocked — deliberate, since it was applied.
- A non-empty payload that fails to parse (after BOM strip) is blocked (fail closed); an empty payload exits 0.
- Case handling is deliberately fail-closed: classification and the git lookup compare paths case-insensitively
  (needed on macOS/Windows where `DB/Migrations/X.SQL` *is* the tracked file). On a case-sensitive filesystem a
  genuinely different path with different casing (e.g. `DB/Migrations/009_new.sql` on Linux) is therefore also
  blocked — an over-block, but the safe direction.
- The `Read(.env.*)` deny rule is deliberately broad: it also blocks `.env.example` (fake values, but the agent has
  no reason to read any dotenv file). Observed side effect: some git commands print a harmless
  `.env.example: Operation not permitted` line in sandboxed sessions — likely because the file-read denial reaches
  git subprocesses too, though that mechanism is not independently confirmed. Narrowing the rule is the owner's
  call, not the agent's.
- If machine-level managed settings allow only managed hooks, the manual run in section 1 is the accepted
  fallback evidence per `docs/ai/hook-test.md` — but on this machine the hook also fired live (section 3).
