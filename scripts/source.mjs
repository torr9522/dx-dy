// Inventory originates from Git, never a recursive development-directory scan.
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { verifyInventory, version } from "./release-utils.mjs";
const files = verifyInventory();
const tar = execFileSync(
  "tar",
  [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--mode=0644",
    "--format=gnu",
    "-cf",
    "-",
    "--",
    ...files,
  ],
  { maxBuffer: 20 * 1024 * 1024 },
);
const archive = gzipSync(tar, { level: 9 });
mkdirSync("dist", { recursive: true });
for (const file of [
  "dist/source.tar.gz",
  `dist/dx-dy-${version()}-source.tar.gz`,
])
  writeFileSync(file, archive, { mode: 0o644 });
console.log(
  "Deterministic tracked-source archive generated; " + files.length + " files.",
);
