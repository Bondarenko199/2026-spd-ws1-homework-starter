// owner: @Bondarenko199 · why: the rubric requires verifiable hook evidence; this battery is the reproducible form of the manual tests in hook-evidence.md · review-by: 2027-02-22
// Run: node docs/ai/hook-battery.mjs   (from anywhere; locates the repo via its own path)
// Every case pipes a Claude Code PreToolUse payload into .claude/hooks/protect-migrations.mjs
// and checks the exit code: 2 = block, 0 = allow.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const R = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."); // repo root from docs/ai/
const H = R + "/.claude/hooks/protect-migrations.mjs";
const run = (payload) => {
  try {
    execFileSync("node", [H], { input: payload, stdio: ["pipe", "ignore", "ignore"] });
    return 0;
  } catch (e) { return e.status; }
};
const bs = String.fromCharCode(92); // backslash, built at runtime so this file's own text stays neutral
const mig = "db" + "/migrations";   // same idea: assembled, not literal, where it matters

const cases = [
  // block cases — instructor round-2 exact scenarios (shell routes at an applied migration)
  ["B1 no-space redirect",        2, JSON.stringify({tool_name:"Bash",tool_input:{command:"echo x>" + mig + "/001_create_tasks.sql"}})],
  ["B2 no-space append",          2, JSON.stringify({tool_name:"Bash",tool_input:{command:"echo x>>" + mig + "/001_create_tasks.sql"}})],
  ["B3 cd + sed -i relative",     2, JSON.stringify({tool_name:"Bash",tool_input:{command:"cd " + mig + " && sed -i 's/120/200/' 001_create_tasks.sql"}})],
  ["B4 spaced redirect",          2, JSON.stringify({tool_name:"Bash",tool_input:{command:"echo x >> " + mig + "/001_create_tasks.sql"}})],
  ["B5 full-path sed -i",         2, JSON.stringify({tool_name:"Bash",tool_input:{command:"sed -i 's/1/2/' " + R + "/" + mig + "/001_create_tasks.sql"}})],
  ["B6 case-variant redirect",    2, JSON.stringify({tool_name:"Bash",tool_input:{command:"echo x > DB/Migrations/001_create_tasks.sql"}})],
  ["B7 tee to applied",           2, JSON.stringify({tool_name:"Bash",tool_input:{command:"echo x | tee " + mig + "/001_create_tasks.sql"}})],
  ["B8 git restore applied",      2, JSON.stringify({tool_name:"Bash",tool_input:{command:"git restore " + mig + "/001_create_tasks.sql"}})],
  ["B9 rm applied",               2, JSON.stringify({tool_name:"Bash",tool_input:{command:"rm " + mig + "/001_create_tasks.sql"}})],
  // allow cases — read-only routes and writes to NEW (untracked) files must pass
  ["A1 cat applied (read)",       0, JSON.stringify({tool_name:"Bash",tool_input:{command:"cat " + mig + "/001_create_tasks.sql"}})],
  ["A2 ls migrations (read)",     0, JSON.stringify({tool_name:"Bash",tool_input:{command:"ls " + mig}})],
  ["A3 git diff (read)",          0, JSON.stringify({tool_name:"Bash",tool_input:{command:"git diff -- " + mig}})],
  ["A4 npm test (read)",          0, JSON.stringify({tool_name:"Bash",tool_input:{command:"npm test 2>&1"}})],
  ["A5 redirect to NEW file",     0, JSON.stringify({tool_name:"Bash",tool_input:{command:"echo x > " + mig + "/003_new.sql"}})],
  ["A6 grep (read)",              0, JSON.stringify({tool_name:"Bash",tool_input:{command:"grep -rn migrations lib"}})],
  ["A7 git log path (read)",      0, JSON.stringify({tool_name:"Bash",tool_input:{command:"git log -- " + mig}})],
  ["A8 ls with redirect to null", 0, JSON.stringify({tool_name:"Bash",tool_input:{command:"ls " + mig + " 2>/dev/null"}})],
  ["A9 commit msg mention (read)",0, JSON.stringify({tool_name:"Bash",tool_input:{command:"git commit -m \"touch " + mig + " docs\""}})],
  // file route: Windows-style backslash path must be classified (and blocked when tracked)
  ["W1 win-style backslash path", 2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:R + bs + "db" + bs + "migrations" + bs + "001_create_tasks.sql"}})],
  // core file-route regression set (rounds 1-2: Codex + instructor findings)
  ["T1 tracked relative",         2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:"db/migrations/001_create_tasks.sql"}})],
  ["T2 new untracked",            0, JSON.stringify({tool_name:"Write",tool_input:{file_path:"db/migrations/003_new.sql"}})],
  ["T3 non-migration",            0, JSON.stringify({tool_name:"Edit",tool_input:{file_path:"lib/tasks.ts"}})],
  ["T4 tracked absolute",         2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:R + "/db/migrations/002_add_task_estimate.sql"}})],
  ["T15 case-variant dir",        2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:R + "/DB/Migrations/001_create_tasks.sql"}})],
  ["T16 upper ext",               2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:R + "/db/migrations/001_create_tasks.SQL"}})],
  ["T17 both variants",           2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:R + "/DB/Migrations/001_create_tasks.SQL"}})],
  ["T18 new case-variant untracked", 0, JSON.stringify({tool_name:"Write",tool_input:{file_path:R + "/DB/Migrations/003_new.sql"}})],
  ["T14 fully nonexistent path",  0, JSON.stringify({tool_name:"Edit",tool_input:{file_path:"/nonexistent/a/b.sql"}})],
];
// environment-dependent cases: run(payload, env)
const runEnv = (payload, env) => {
  try {
    execFileSync("node", [H], { input: payload, stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, ...env } });
    return 0;
  } catch (e) { return e.status; }
};
let fails = 0;
for (const [label, want, payload] of cases) {
  const got = run(payload);
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " " + label + ": got " + got + ", want " + want);
}
// T8: git errors (cwd does not exist) — must FAIL CLOSED
{
  const got = runEnv(JSON.stringify({tool_name:"Edit",tool_input:{file_path:"db/migrations/001_create_tasks.sql"}}), { CLAUDE_PROJECT_DIR: "/nonexistent/repo" });
  const ok = got === 2;
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " T8 git-error fail-closed: got " + got + ", want 2");
}

// ── Round-3 review findings (code-review max): each was a verified bypass or over-block ──
const bash = (command) => JSON.stringify({tool_name:"Bash",tool_input:{command}});
const editPath = (p) => JSON.stringify({tool_name:"Edit",tool_input:{file_path:p}});
const block = [
  ["R1 sed --in-place long form",   2, bash("sed --in-place 's/120/200/' db/migrations/002_add_task_estimate.sql")],
  ["R1b cat > tracked (redirect target decides)", 2, bash("cat foo > db/migrations/001_create_tasks.sql")],
  ["R2a touch tracked",             2, bash("touch db/migrations/001_create_tasks.sql")],
  ["R2b find -delete on migrations",2, bash("find db/migrations -name '*.sql' -delete")],
  ["R2c rsync into migrations",     2, bash("rsync -a empty/ db/migrations/")],
  ["R6 non-string file_path (crash guard)", 2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:123}})],
  ["R6b object file_path (crash guard)",    2, JSON.stringify({tool_name:"Edit",tool_input:{file_path:{nested:true}}})],
  ["R-garbage non-empty payload",   2, "this is not json at all {"],
  // cd-adjacent routes (found by probing the dirContext narrowing; `/simplify` round 3)
  ["R11 cd db + sed -i migrations/001", 2, bash("cd db && sed -i 's/1/2/' migrations/001_create_tasks.sql")],
  ["R12 cd db + rm migrations/001",     2, bash("cd db && rm migrations/001_create_tasks.sql")],
  ["R13 cd db/ + truncate migrations/…",2, bash("cd db/ && truncate -s0 migrations/001_create_tasks.sql")],
];
for (const [label, want, payload] of block) {
  const got = run(payload);
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " " + label + ": got " + got + ", want " + want);
}
const allow = [
  ["R3 sed -n print-only (read)",   0, bash("sed -n 's/i/x/p' db/migrations/001_create_tasks.sql")],
  ["R3b perl -pe print-only",       0, bash("perl -pe 's/i/x/' db/migrations/001_create_tasks.sql")],
  ["R3c git checkout -b branch",    0, bash("git checkout -b add-migrations-support")],
  ["R3d grep install (false verb)", 0, bash("grep -rn install db/migrations")],
  ["R3e tee to a .log file",        0, bash("npm test | tee migrations.log")],
  ["R14 cd db + ls migrations/ (read-only)", 0, bash("cd db && ls migrations/")],
  ["R15 cd db + cat migrations/001 (read-only)", 0, bash("cd db && cat migrations/001_create_tasks.sql")],
  ["R16 cd db + tee out.log (non-migration target)", 0, bash("cd db && npm run x | tee out.log")],
  ["R8 2>&1 on cat (fd-dup)",       0, bash("cat db/migrations/001_create_tasks.sql 2>&1")],
  ["R8b git diff > /tmp (out sink)",0, bash("git diff -- db/migrations > /tmp/mig.diff")],
  ["R-empty payload (manual run)",  0, ""],
];
for (const [label, want, payload] of allow) {
  const got = run(payload);
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " " + label + ": got " + got + ", want " + want);
}
// stderr assertion: block cases must actually explain why (guards against exit-code-only regressions)
{
  try {
    execFileSync("node", [H], { input: JSON.stringify({tool_name:"Edit",tool_input:{file_path:"db/migrations/001_create_tasks.sql"}}), stdio: ["pipe","ignore","pipe"] });
    fails++; console.log("FAIL stderr-message: expected block, got exit 0");
  } catch (e) {
    const msg = (e.stderr || "").toString();
    const ok = e.status === 2 && msg.includes("BLOCKED") && msg.includes("add-migration");
    if (!ok) fails++;
    console.log((ok ? "PASS" : "FAIL") + " stderr-message on block: exit " + e.status + ", stderr " + msg.length + " chars");
  }
}
// temp-repo cases: case-sensitive pathspec bug + cd + untracked fix-in-place (R2, R7)
{
  const S = mkdtempSync(tmpdir() + "/hwbatt-");
  cpSync(R + "/db", S + "/db", { recursive: true });
  cpSync(R + "/.claude", S + "/.claude", { recursive: true });
  // a tracked migration with uppercase letters in the name (pathspec-case bug repro)
  writeFileSync(S + "/db/migrations/002_Mixed_Case.sql", "-- mixed case tracked\n");
  const g = (...a) => execFileSync("git", a, { cwd: S, stdio: "ignore" });
  g("init", "-q"); g("add", "-A"); g("-c","user.email=t@t","-c","user.name=t","commit","-q","-m","x");
  // an untracked draft migration (fix-in-place must stay allowed)
  writeFileSync(S + "/db/migrations/003_draft.sql", "-- draft, not yet committed\n");
  const HS = S + "/.claude/hooks/protect-migrations.mjs";
  const runIn = (payload, env = {}) => {
    try {
      execFileSync("node", [HS], { input: payload, stdio: ["pipe","ignore","ignore"], env: { ...process.env, CLAUDE_PROJECT_DIR: S, ...env } });
      return 0;
    } catch (e) { return e.status; }
  };
  const tempCases = [
    ["R2 tracked mixed-case name (pathspec bug)", 2, editPath(S + "/db/migrations/002_Mixed_Case.sql")],
    ["R2b tracked mixed-case via Bash", 2, bash("sed -i 's/1/2/' db/migrations/002_Mixed_Case.sql")],
    ["R7 cd + sed -i on UNTRACKED draft stays allowed", 0, bash("cd db/migrations && sed -i 's/typo/fix/' 003_draft.sql")],
    ["R7b cd + sed -i on TRACKED (after cd) blocks", 2, bash("cd db/migrations && sed -i 's/120/200/' 001_create_tasks.sql")],
    ["R7c redirect to untracked draft stays allowed", 0, bash("echo x > db/migrations/003_draft.sql")],
  ];
  for (const [label, want, payload] of tempCases) {
    const got = runIn(payload);
    const ok = got === want;
    if (!ok) fails++;
    console.log((ok ? "PASS" : "FAIL") + " " + label + ": got " + got + ", want " + want);
  }
  // non-ASCII tracked name (quotePath bug repro)
  writeFileSync(S + "/db/migrations/004_créer_tâches.sql", "-- non-ascii name\n");
  g("add", "-A"); g("-c","user.email=t@t","-c","user.name=t","commit","-q","-m","y");
  {
    const got = runIn(editPath(S + "/db/migrations/004_créer_tâches.sql"));
    const ok = got === 2;
    if (!ok) fails++;
    console.log((ok ? "PASS" : "FAIL") + " R10 non-ASCII tracked name (quotePath): got " + got + ", want 2");
  }
  rmSync(S, { recursive: true, force: true });
}
// BOM payload: must parse (BOM stripped) and BLOCK (exit 2) — was a fail-open before the fix
const bomPayload = "﻿" + JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "db/migrations/001_create_tasks.sql" } });
const bomGot = run(bomPayload);
const bomOk = bomGot === 2;
if (!bomOk) fails++;
console.log((bomOk ? "PASS" : "FAIL") + " BOM payload parses and blocks: got " + bomGot + ", want 2");
console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
