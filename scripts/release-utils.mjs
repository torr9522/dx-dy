import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
export function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}
export const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
export const version = () =>
  JSON.parse(readFileSync("package.json", "utf8")).version;
export const forbidden = (file) =>
  /(^|\/)(?:\.env(?:\..*)?|node_modules|data|backups|logs|secrets?|dist|coverage|playwright-report|test-results)(\/|$)|\.(?:sqlite\w*(?:-.*)?|db(?:-.*)?|secret|tar|tar\.gz|tgz)$|(^|\/)temporary-nodes/.test(
    file,
  ) && file !== ".env.example";
export function sourceFiles() {
  const files = JSON.parse(readFileSync("scripts/source-files.json", "utf8"));
  if (!Array.isArray(files) || !files.length)
    throw new Error("Invalid Git source inventory");
  for (const file of files) {
    if (
      typeof file !== "string" ||
      file.startsWith("/") ||
      file.includes("..") ||
      file.includes("\n") ||
      forbidden(file)
    )
      throw new Error("Unsafe source inventory path");
    if (!lstatSync(path.resolve(file)).isFile())
      throw new Error("Source must be regular files: " + file);
  }
  if (new Set(files).size !== files.length)
    throw new Error("Duplicate inventory entries");
  return [...files].sort();
}
export function verifyInventory() {
  const files = sourceFiles();
  let present = false;
  try {
    lstatSync(".git");
    present = true;
  } catch {
    /* Git-free Docker/source tree */
  }
  if (present) {
    const tracked = git("ls-files", "-z").split("\0").filter(Boolean).sort();
    if (JSON.stringify(files) !== JSON.stringify(tracked))
      throw new Error(
        "Stage intended files, run pnpm source:manifest and commit the inventory",
      );
  }
  return files;
}
export const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
