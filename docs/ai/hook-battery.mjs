// owner: @Bondarenko199 · why: the rubric requires verifiable hook evidence; this battery is the reproducible form of the manual tests in hook-evidence.md · review-by: 2027-02-22
// Run: node docs/ai/hook-battery.mjs   (from anywhere; locates the repo via its own path)
// Every case pipes a Claude Code PreToolUse payload into .claude/hooks/protect-migrations.mjs
// and checks the exit code: 2 = block, 0 = allow.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
// BOM payload: must parse (BOM stripped) and BLOCK (exit 2) — was a fail-open before the fix
const bomPayload = "﻿" + JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "db/migrations/001_create_tasks.sql" } });
const bomGot = run(bomPayload);
const bomOk = bomGot === 2;
if (!bomOk) fails++;
console.log((bomOk ? "PASS" : "FAIL") + " BOM payload parses and blocks: got " + bomGot + ", want 2");
console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
