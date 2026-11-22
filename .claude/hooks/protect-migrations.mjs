// owner: @Bondarenko199 · why: an applied migration was edited once and a teammate's DB silently diverged; this hook makes applied migrations immutable · review-by: 2027-02-22
// PreToolUse hook: reads the Claude Code JSON payload on stdin.
// Exit 2 = block the tool call; the stderr text is shown to the agent as the reason.
// Blocks Edit/Write/MultiEdit on an APPLIED db/migrations/*.sql file (one tracked in git).
// Creating a NEW migration file — or fixing an uncommitted one — is allowed.
import { execFileSync } from "node:child_process";
import { isAbsolute, resolve, relative, sep } from "node:path";

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // unreadable payload: fail open, the permission system still applies
  }

  const filePath = payload?.tool_input?.file_path;
  if (!filePath) process.exit(0);

  // CLAUDE_PROJECT_DIR is set by Claude Code; fall back to the repo root derived from this
  // script's own location (script lives at <root>/.claude/hooks/) so the hook still works
  // if the agent has cd'd elsewhere in the session.
  const projectRoot = process.env.CLAUDE_PROJECT_DIR
    ?? resolve(new URL("..", import.meta.url).pathname, "..");

  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);

  // Only care about migration SQL files inside this project.
  const rel = relative(projectRoot, abs);
  const isMigration = !rel.startsWith("..") && !isAbsolute(rel)
    && rel.split(sep).slice(0, 2).join(sep) === ["db", "migrations"].join(sep)
    && rel.endsWith(".sql");
  if (!isMigration) process.exit(0);

  // "Applied" = tracked by git. A brand-new, never-committed migration can still be fixed
  // in place (the add-migration skill's verify step may reveal a typo); once committed it
  // is immutable and must be superseded by a new numbered migration.
  let tracked = false;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", rel], { cwd: projectRoot, stdio: "ignore" });
    tracked = true;
  } catch (e) {
    if (e.status === 1) {
      tracked = false; // git ran fine and reported the file as untracked
    } else {
      tracked = true; // git failed (not a repo, missing, ...) — fail closed, treat as applied
    }
  }

  if (!tracked) process.exit(0);

  console.error(
    `BLOCKED: editing an applied migration is forbidden (db/migrations is immutable once committed).\n` +
    `File: ${rel}\n` +
    `Instead, add a NEW numbered migration: db/migrations/<next-number>_<what_it_does>.sql\n` +
    `Follow the add-migration skill: .claude/skills/add-migration/SKILL.md`,
  );
  // Set the exit code and let the process end naturally so stderr is flushed — an immediate
  // process.exit(2) can truncate the buffered message on pipes (code review finding #4).
  process.exitCode = 2;
});
