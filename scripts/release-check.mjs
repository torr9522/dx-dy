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
  quote,
} from "./release-utils.mjs";
import { secretScan } from "./secret-scan.mjs";
import { verifySource } from "./verify-source.mjs";

const full = process.argv.includes("--full");
const detached = process.argv.includes("--fresh-child");
const allowed = new Set(["--full", "--fresh-child"]);
if (process.argv.slice(2).some((a) => !allowed.has(a)))
  throw new Error("Usage: pnpm release:check [--full]");
if (git("status", "--porcelain"))
  throw new Error(
    "Release gate requires clean committed Git, including untracked source",
  );
const branch = git("branch", "--show-current");
const releaseHead = git("rev-parse", "HEAD");
if (branch !== "master" && !(detached && branch === ""))
  throw new Error("Expected master branch");
const forbiddenTracked = git("ls-files", "-z")
  .split("\0")
  .filter(Boolean)
  .filter(forbidden);
if (forbiddenTracked.length)
  throw new Error("Tracked runtime/backup artifact: " + forbiddenTracked[0]);
const files = verifyInventory();
const v = version();
if (!/^\d+\.[0-9]\.[0-9]$/.test(v))
  throw new Error("Invalid decimal product version");
for (const [file, text] of [
  ["README.md", "Private Subscription Manager " + v],
  ["apps/api/src/app.ts", `version: "${v}"`],
  ["apps/api/src/main.ts", `version: "${v}"`],
  ["apps/api/src/app.ts", `private-subscription-manager-${v}-source.tar.gz`],
  ["docker-compose.yml", "private-subscription-manager:" + v],
])
  if (!readFileSync(file, "utf8").includes(text))
    throw new Error("Version drift in " + file);
if (!readFileSync("CHANGELOG.md", "utf8").includes("[" + v + "-rc."))
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
const metadata = JSON.parse(readFileSync("package.json", "utf8"));
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
if (git("status", "--porcelain"))
  throw new Error(
    "Build modified source or created untracked release artifacts",
  );

if (full) {
  const root = process.cwd();
  const temp = mkdtempSync(
    path.join(
      process.env.RELEASE_TMPDIR || os.tmpdir(),
      "private-subscription-manager-release-check-",
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
    run("node", ["scripts/release-check.mjs", "--fresh-child"], {
      cwd: checkout,
      env: {
        ...process.env,
        RELEASE_PNPM_STORE: path.join(temp, "pnpm-store"),
      },
    });
    const hash = (file) =>
      createHash("sha256").update(readFileSync(file)).digest("hex");
    if (
      hash("dist/source.tar.gz") !==
      hash(path.join(checkout, "dist/source.tar.gz"))
    )
      throw new Error(
        "Source archive differs between working tree and fresh checkout",
      );
    const sshHost = process.env.RELEASE_DOCKER_SSH;
    if (sshHost && !/^[A-Za-z0-9_.@:-]+$/.test(sshHost))
      throw new Error("Invalid build host");
    const ssh = (cmd, options = {}) => {
      const password = process.env.RELEASE_SSH_PASSWORD;
      const binary = password ? "sshpass" : "ssh";
      const args = [...(password ? ["-e", "ssh"] : []), sshHost, cmd];
      return execFileSync(binary, args, {
        env: { ...process.env, ...(password ? { SSHPASS: password } : {}) },
        ...options,
      });
    };
    if (sshHost) {
      // Temporary isolated build only. Never read/write deployment .env or use Compose.
      const remote = ssh("mktemp -d /tmp/psm-release-build-XXXXXX", {
        encoding: "utf8",
      }).trim();
      if (!/^\/tmp\/psm-release-build-[A-Za-z0-9]+$/.test(remote))
        throw new Error("Unsafe remote temp directory");
      try {
        const archive = execFileSync(
          "git",
          ["archive", "--format=tar", "HEAD"],
          { cwd: checkout, maxBuffer: 20 * 1024 * 1024 },
        );
        ssh(`tar -xf - -C ${quote(remote)}`, {
          input: archive,
          stdio: ["pipe", "inherit", "inherit"],
        });
        const commit = git("rev-parse", "HEAD");
        ssh(
          `docker run --rm -v ${quote(remote + ":" + remote)} -w ${quote(remote)} -v /usr/bin/docker:/usr/bin/docker:ro -v /var/run/docker.sock:/var/run/docker.sock node:26.10.0-bookworm-slim node scripts/docker-release-check.mjs ${quote(commit)}`,
          { stdio: "inherit" },
        );
      } finally {
        ssh(`rm -rf -- ${quote(remote)}`, { stdio: "inherit" });
      }
    } else {
      run("docker", ["info"], { stdio: "ignore" });
      run(
        "node",
        ["scripts/docker-release-check.mjs", git("rev-parse", "HEAD")],
        { cwd: checkout },
      );
    }
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
      ? " (full: fresh checkout + no-cache Docker + isolated runtime smoke)"
      : ""),
);
