// owner: @Bondarenko199 · why: an applied migration was edited once and a teammate's DB silently diverged; this hook makes applied migrations immutable · review-by: 2027-02-22
// PreToolUse hook: reads the Claude Code JSON payload on stdin.
// Exit 2 = block the tool call; the stderr text is shown to the agent as the reason.
// Blocks Edit/Write/MultiEdit on an EXISTING db/migrations/*.sql file. Creating a NEW migration file is allowed.
import { existsSync } from "node:fs";
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

  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);

  // Only care about migration SQL files inside this project.
  const rel = relative(projectRoot, abs);
  const isMigration = !rel.startsWith("..") && !isAbsolute(rel)
    && rel.split(sep).slice(0, 2).join(sep) === ["db", "migrations"].join(sep)
    && rel.endsWith(".sql");
  if (!isMigration) process.exit(0);

  // New file → allowed. Editing anything that already exists on disk → blocked.
  if (!existsSync(abs)) process.exit(0);

  console.error(
    `BLOCKED: editing an applied migration is forbidden (db/migrations is immutable once applied).\n` +
    `File: ${rel}\n` +
    `Instead, add a NEW numbered migration: db/migrations/<next-number>_<what_it_does>.sql\n` +
    `Follow the add-migration skill: .claude/skills/add-migration/SKILL.md`,
  );
  process.exit(2);
});
