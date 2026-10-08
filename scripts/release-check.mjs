import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  forbidden,
  git,
  run,
  version,
  verifyInventory,
} from "./release-utils.mjs";
import { secretScan } from "./secret-scan.mjs";
import { verifySource } from "./verify-source.mjs";
import { validateRepositoryRef } from "./ci-ref-check.mjs";

const full = process.argv.includes("--full");
const publicMode = process.argv.includes("--public");
const detached = process.argv.includes("--fresh-child");
const allowed = new Set(["--full", "--public", "--fresh-child"]);
if (process.argv.slice(2).some((a) => !allowed.has(a)))
  throw new Error("Usage: pnpm release:check [--full] [--public]");
if (git("status", "--porcelain"))
  throw new Error(
    "Release gate requires clean committed Git, including untracked source",
  );
const releaseHead = git("rev-parse", "HEAD");
const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const v = version();
validateRepositoryRef({ version: v, allowLocalDetached: detached });
const forbiddenTracked = git("ls-files", "-z")
  .split("\0")
  .filter(Boolean)
  .filter(forbidden);
if (forbiddenTracked.length)
  throw new Error("Tracked runtime/backup artifact: " + forbiddenTracked[0]);
const files = verifyInventory();
if (!/^\d+\.[0-9]\.[0-9]$/.test(v))
  throw new Error("Invalid decimal product version");
for (const [file, text] of [
  ["README.md", "dx-dy " + v],
  ["apps/api/src/app.ts", `version: "${v}"`],
  ["apps/api/src/main.ts", `version: "${v}"`],
  ["apps/api/src/app.ts", `dx-dy-${v}-source.tar.gz`],
  ["deploy/native/install.conf.example", "DXDY_VERSION=" + v],
  ["deploy/native/dx-dy.service", "User=dx-dy"],
])
  if (!readFileSync(file, "utf8").includes(text))
    throw new Error("Version drift in " + file);
if (!readFileSync("CHANGELOG.md", "utf8").includes("[" + v + "]"))
  throw new Error("Missing release changelog");
if (
  !readFileSync("LICENSE", "utf8").includes("GNU AFFERO GENERAL PUBLIC LICENSE")
)
  throw new Error("AGPL license missing");
if (
  !readFileSync("THIRD_PARTY_NOTICES.md", "utf8").includes(
    "a3e61061e50b40e5c5938969aab915d05d8d7069",
  )
)
  throw new Error("Pinned provenance missing");
if (
  execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim() !==
  metadata.packageManager.split("@")[1]
)
  throw new Error("Use pinned packageManager");
console.log(
  `Release gate: ${git("rev-parse", "HEAD")} product=${v} tracked=${files.length}`,
);
await secretScan();
run("pnpm", [
  "install",
  "--frozen-lockfile",
  ...(process.env.RELEASE_PNPM_STORE
    ? ["--store-dir", process.env.RELEASE_PNPM_STORE]
    : []),
]);
const audit = spawnSync("pnpm", ["audit", "--json"], { encoding: "utf8" });
let counts;
try {
  counts = JSON.parse(audit.stdout).metadata.vulnerabilities;
} catch {
  throw new Error("Dependency audit failed");
}
console.log("Dependency audit: " + JSON.stringify(counts));
if (audit.status !== 0)
  throw new Error(
    "Audit findings require review before gate passes; no force upgrades",
  );
for (const script of ["lint", "typecheck", "test", "build"])
  run("pnpm", [script]);
await verifySource();
if (publicMode) run("node", ["scripts/public-release-check.mjs"]);
if (git("status", "--porcelain"))
  throw new Error(
    "Build modified source or created untracked release artifacts",
  );

if (full) {
  const root = process.cwd();
  const temp = mkdtempSync(
    path.join(
      process.env.RELEASE_TMPDIR || os.tmpdir(),
      "dx-dy-release-check-",
    ),
  );
  const checkout = path.join(temp, "checkout");
  let added = false;
  try {
    run("git", ["worktree", "add", "--detach", checkout, "HEAD"]);
    added = true;
    for (const item of [".env", "data", "node_modules", "dist"])
      if (existsSync(path.join(checkout, item)))
        throw new Error("Fresh checkout inherited " + item);
    console.log("Fresh checkout: " + checkout);
    run(
      "node",
      [
        "scripts/release-check.mjs",
        "--fresh-child",
        ...(publicMode ? ["--public"] : []),
      ],
      {
        cwd: checkout,
        env: {
          ...process.env,
          RELEASE_PNPM_STORE: path.join(temp, "pnpm-store"),
        },
      },
    );
    const hash = (file) =>
      createHash("sha256").update(readFileSync(file)).digest("hex");
    if (
      hash("dist/source.tar.gz") !==
      hash(path.join(checkout, "dist/source.tar.gz"))
    )
      throw new Error(
        "Source archive differs between working tree and fresh checkout",
      );
    for (const architecture of ["amd64", "arm64"])
      run("node", ["scripts/build-native-artifact.mjs", architecture]);
    run("node", ["scripts/native-release-check.mjs"]);
  } finally {
    if (added)
      run("git", ["worktree", "remove", "--force", checkout], { cwd: root });
    rmSync(temp, { recursive: true, force: true });
  }
}
if (git("rev-parse", "HEAD") !== releaseHead || git("status", "--porcelain"))
  throw new Error(
    "Release source changed during validation; rerun from frozen committed HEAD",
  );
console.log(
  "LOCAL RELEASE GATE: PASS" +
    (full
      ? " (full: fresh checkout + amd64/arm64 native artifacts + runtime smoke)"
      : ""),
);
