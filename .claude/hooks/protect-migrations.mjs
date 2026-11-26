// owner: @Bondarenko199 · why: an applied migration was edited once and a teammate's DB silently diverged; this hook makes applied migrations immutable · review-by: 2027-02-22
// PreToolUse hook: reads the Claude Code JSON payload on stdin.
// Exit 2 = block the tool call; the stderr text is shown to the agent as the reason.
// Blocks Edit/Write/MultiEdit on an APPLIED db/migrations/*.sql file (one tracked in git).
// Creating a NEW migration file — or fixing an uncommitted one — is allowed.
import { execFileSync } from "node:child_process";
import { isAbsolute, resolve, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

/**
 * Canonicalize a path: realpath the nearest existing ancestor (so symlinked directories
 * and symlinked filenames resolve to their real target), then re-append the remainder
 * that does not exist yet (a brand-new migration file, or a tracked file deleted from
 * the working tree but still in git). Plain resolve() is not enough: a path through a
 * symlink would keep its alias form and escape the db/migrations classification.
 * realpathSync.native (not the JS realpath) also normalizes case on case-insensitive
 * filesystems (macOS APFS, Windows), so DB/Migrations/001.SQL cannot alias the tracked
 * db/migrations/001.sql.
 */
function canonical(p) {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    // find the longest existing prefix, realpath it, re-append the non-existent tail
    const parts = abs.split(sep);
    for (let i = parts.length - 1; i > 0; i--) {
      const head = parts.slice(0, i).join(sep);
      try {
        return realpathSync.native(head) + sep + parts.slice(i).join(sep);
      } catch {
        if (dirname(head) === head) break; // reached the filesystem root, stop
        // prefix doesn't exist either, walk further up
      }
    }
    return abs;
  }
}

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  // strip a leading UTF-8 BOM — JSON.parse throws on it and the hook would fail open
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Non-empty but unparseable payload: fail closed (exit 2) — the safe direction for an
    // immutability guard; Claude Code shows stderr so the block is diagnosable.
    // Empty stdin (hook run manually without input): nothing to guard, exit 0.
    if (raw.trim().length > 0) {
      console.error("BLOCKED: hook received an unparseable payload (fail-closed).");
      process.exitCode = 2;
      return;
    }
    process.exit(0);
  }

  // ── Bash route: the Edit/Write guard is bypassable via shell commands, so inspect the
  // command line too. The check mirrors the file-route logic: extract migration-file
  // arguments from the command, resolve each against the project root, and block only if
  // a referenced file is TRACKED (applied). A redirect to a brand-new 003_*.sql stays
  // allowed, exactly like Write of a new migration. Fail closed: a write verb combined
  // with a migrations reference we cannot resolve cleanly is also blocked.
  if (payload?.tool_name === "Bash") {
    const cmd = String(payload?.tool_input?.command ?? "");
    const cmdLower = cmd.toLowerCase();
    const projectRootBash = process.env.CLAUDE_PROJECT_DIR
      ? canonical(process.env.CLAUDE_PROJECT_DIR)
      : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

    const referencesMigrations =
      cmdLower.includes("migrations")
      || /(^|[^a-z0-9])\d{2,3}_[a-z0-9_]+\.sql/.test(cmdLower);
    if (!referencesMigrations) process.exit(0); // unrelated command, nothing to guard

    // redirects to null sinks are not writes to the repo
    const cmdNoSink = cmd.replace(/>\s*\/dev\/null/g, " ").replace(/>>\s*\/dev\/null/g, " ");
    const writeish =
      /(^|\s|;|&&|\|\|)(sed\s+-[^i]*i|perl\s+-[^e]*pi?e?|tee|cp|mv|rm|truncate|dd|install|patch)\b/.test(cmdLower)
      || /(^|\s)(git\s+(restore|checkout|clean)(\s|$))/.test(cmdLower)
      || /(^|\s)(heredoc\b|<<)/.test(cmd)
      || />|>>/.test(cmdNoSink);
    if (!writeish) process.exit(0); // read-only mention (cat, ls, git log, grep…)

    // candidate migration file paths mentioned in the command (basename or path form)
    const candidates = new Set();
    for (const m of cmd.matchAll(/[\w.\/\\-]*\d{2,3}_[\w-]*\.sql/gi)) candidates.add(m[0]);
    for (const m of cmd.matchAll(/db[\/\\]+migrations[\w.\/\\-]*/gi)) candidates.add(m[0]);

    // If no concrete file can be extracted (e.g. `cd db/migrations && sed -i …`), or the
    // command writes with an unresolvable target, fail closed.
    let resolvedAny = false;
    let trackedHit = false;
    for (const cand of candidates) {
      const absCand = canonical(isAbsolute(cand) ? cand : resolve(projectRootBash, cand));
      const relCand = relative(projectRootBash, absCand).split(sep).join("/");
      if (relCand.startsWith("..") || isAbsolute(relCand)) continue;
      if (!relCand.toLowerCase().startsWith("db/migrations/") || !relCand.toLowerCase().endsWith(".sql")) continue;
      resolvedAny = true;
      try {
        const listed = execFileSync("git", ["ls-files", "--", relCand], { cwd: projectRootBash, encoding: "utf8" });
        if (listed.split("\n").some((f) => f.toLowerCase() === relCand.toLowerCase())) { trackedHit = true; break; }
      } catch {
        trackedHit = true; break; // git failed — fail closed
      }
    }
    if (trackedHit || (writeish && !resolvedAny)) {
      console.error(
        `BLOCKED: this shell command could modify an applied migration (db/migrations is immutable).\n` +
        `Command: ${cmd.slice(0, 200)}\n` +
        `Instead, add a NEW numbered migration per .claude/skills/add-migration/SKILL.md`,
      );
      process.exitCode = 2;
      return;
    }
    process.exit(0); // write routed at untracked/new files only
  }

  const filePathRaw = payload?.tool_input?.file_path;
  if (!filePathRaw) process.exit(0);
  // Windows-style backslash separators: normalize to the host's separator so that a
  // payload written with \ (Claude Code on Windows, or a copy-pasted path) classifies the
  // same as one written with /. Harmless on POSIX, where a literal \ in a filename is
  // rare and fail-closed is the safe direction.
  const filePath = filePathRaw.replace(/[\\/]+/g, sep);

  // CLAUDE_PROJECT_DIR is set by Claude Code; fall back to the repo root derived from this
  // script's own location (script lives at <root>/.claude/hooks/) so the hook still works
  // if the agent has cd'd elsewhere in the session. fileURLToPath (not URL.pathname) so
  // paths with spaces or other URL-encoded characters resolve correctly.
  const projectRoot = process.env.CLAUDE_PROJECT_DIR
    ? canonical(process.env.CLAUDE_PROJECT_DIR)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

  // Canonicalize both sides so symlink aliases (/tmp vs /private/tmp on macOS, or a
  // user-level symlink to the repo) still compare equal — otherwise relative() reports
  // a false ../ escape and the hook silently allows an applied-migration edit.
  const abs = canonical(isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath));

  // Only care about migration SQL files inside this project. Compare case-insensitively:
  // on case-insensitive filesystems (macOS APFS, Windows) DB/Migrations/X.SQL is the same
  // file as db/migrations/x.sql, and the .SQL extension must not escape the check either.
  const rel = relative(projectRoot, abs);
  // Windows: relative() yields backslash separators, but git ls-files prints forward
  // slashes — normalize before any comparison.
  const relGit = rel.split(sep).join("/");
  const relLower = relGit.toLowerCase();
  const isMigration = !rel.startsWith("..") && !isAbsolute(rel)
    && relLower.startsWith("db/migrations/")
    && relLower.endsWith(".sql");
  if (!isMigration) process.exit(0);

  // "Applied" = tracked by git. A brand-new, never-committed migration can still be fixed
  // in place (the add-migration skill's verify step may reveal a typo); once committed it
  // is immutable and must be superseded by a new numbered migration. Git pathspecs are
  // case-sensitive, so query the tracked list and match case-insensitively instead of
  // trusting the payload's casing.
  let tracked = false;
  try {
    const listed = execFileSync("git", ["ls-files", "--", relGit], { cwd: projectRoot, encoding: "utf8" });
    tracked = listed.split("\n").some((f) => f.toLowerCase() === relLower);
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
