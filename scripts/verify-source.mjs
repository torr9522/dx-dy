import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { verifyInventory, forbidden, run } from "./release-utils.mjs";
import { secretScan } from "./secret-scan.mjs";
export async function verifySource() {
  const archive = path.resolve("dist/source.tar.gz");
  const files = verifyInventory();
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .sort();
  if (
    JSON.stringify(files) !== JSON.stringify(listing) ||
    listing.some(forbidden)
  )
    throw new Error("Source archive inventory mismatch");
  const verbose = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" });
  if (
    verbose
      .split("\n")
      .filter(Boolean)
      .some((line) => !line.startsWith("-"))
  )
    throw new Error("Non-regular archive entries");
  for (const file of [
    "LICENSE",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "pnpm-lock.yaml",
    "migrations/001_initial.sql",
  ])
    if (!listing.includes(file))
      throw new Error("Missing corresponding source: " + file);
  const temp = mkdtempSync(
    path.join(process.env.RELEASE_TMPDIR || os.tmpdir(), "psm-source-verify-"),
  );
  try {
    run("tar", ["-xzf", archive, "-C", temp]);
    for (const file of files)
      if (!readFileSync(file).equals(readFileSync(path.join(temp, file))))
        throw new Error("Archive differs from built source: " + file);
    await secretScan(temp);
    const first = readFileSync(archive);
    run("node", ["scripts/source.mjs"]);
    if (!first.equals(readFileSync(archive)))
      throw new Error("Source archive is not deterministic");
    console.log(
      "Source archive: PASS; tracked files=" +
        files.length +
        "; sha256=" +
        createHash("sha256").update(first).digest("hex"),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) await verifySource();
