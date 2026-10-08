import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { forbidden, git } from "./release-utils.mjs";

const required = [
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md",
  "install.sh",
  "ops/dx-dy",
  "deploy/docker-compose.yml",
  "deploy/Caddyfile.single",
  "deploy/Caddyfile.dual",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "docs/README.md",
  "docs/CAPABILITY_TREE.md",
  "docs/ARCHITECTURE.md",
  "docs/DEVELOPMENT_HISTORY.md",
  "docs/DEVELOPMENT_PROCESS.md",
  "docs/DESIGN_DECISIONS.md",
  "docs/PROTOCOL_COMPATIBILITY.md",
  "docs/DATABASE_AND_MIGRATION.md",
  "docs/BACKUP_AND_RECOVERY.md",
  "docs/INSTALLATION_AND_OPERATIONS.md",
  "docs/TESTING_AND_RELEASE.md",
  "docs/SECURITY_MODEL.md",
  "docs/KNOWN_LIMITATIONS.md",
  "docs/CURRENT_BASELINE.md",
];
for (const file of required)
  if (!existsSync(file))
    throw new Error("Missing public release asset: " + file);
const metadata = JSON.parse(readFileSync("package.json", "utf8"));
if (metadata.name !== "dx-dy" || metadata.version !== "0.1.8")
  throw new Error("Public brand/version mismatch");
if (!readFileSync("README.md", "utf8").startsWith("# dx-dy 0.1.8"))
  throw new Error("README public identity mismatch");
const publicRepository = "torr9522/dx-dy";
const readme = readFileSync("README.md", "utf8");
const installer = readFileSync("install.sh", "utf8");
if (
  !readme.includes(
    `https://github.com/${publicRepository}/releases/latest/download/install.sh`,
  ) ||
  !installer.includes(`DXDY_DEFAULT_REPOSITORY="${publicRepository}"`)
)
  throw new Error("Final public repository coordinate is missing");
if (/<OWNER>|YOUR_GITHUB_USERNAME|yourname\/dx-dy/.test(readme + installer))
  throw new Error("Placeholder repository coordinate remains");
const agentGuide = readFileSync("AGENTS.md", "utf8");
const baseline = readFileSync("docs/CURRENT_BASELINE.md", "utf8");
const capabilities = readFileSync("docs/CAPABILITY_TREE.md", "utf8");
for (const [label, content, terms] of [
  [
    "agent guide",
    agentGuide,
    ["NO AUTO SUBSCRIPTION", "0.1.9", "pnpm release:check --full --public"],
  ],
  [
    "current baseline",
    baseline,
    ["001_initial.sql", "002_node_collections.sql", "Migration in 0.1.8: **NONE**"],
  ],
  [
    "capability tree",
    capabilities,
    ["Semantic duplicate protection", "Full Migration", "amd64/arm64"],
  ],
])
  for (const term of terms)
    if (!content.includes(term))
      throw new Error(`Incomplete ${label}: missing ${term}`);
const knowledgeDocs = required.filter(
  (file) => file === "AGENTS.md" || file === "README.md" || file.endsWith(".md"),
);
for (const file of knowledgeDocs) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const link = match[1].split("#", 1)[0];
    if (!link || /^(?:https?:|mailto:)/.test(link)) continue;
    const target = path.resolve(path.dirname(file), decodeURIComponent(link));
    if (!existsSync(target))
      throw new Error(`Broken relative link in ${file}: ${match[1]}`);
  }
}
for (const file of ["install.sh", "ops/dx-dy"]) {
  const content = readFileSync(file, "utf8");
  if (!content.startsWith("#!/usr/bin/env bash\nset -Eeuo pipefail"))
    throw new Error("Unsafe shell entrypoint: " + file);
  if (!(statSync(file).mode & 0o111))
    throw new Error("Shell entrypoint is not executable: " + file);
}
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const bad = tracked.filter(forbidden);
if (bad.length) throw new Error("Forbidden public artifact: " + bad[0]);
for (const workflow of [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
])
  YAML.parse(readFileSync(workflow, "utf8"));
const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
if (/\bssh\b|production/i.test(releaseWorkflow))
  throw new Error("Release workflow must not deploy production");
const compose = readFileSync("deploy/docker-compose.yml", "utf8");
if (/docker\.sock|privileged\s*:\s*true/i.test(compose))
  throw new Error("Public Compose grants unsafe privileges");
execFileSync("shellcheck", ["-x", "install.sh", "ops/dx-dy"], {
  stdio: "inherit",
});

const temp = mkdtempSync(path.join(os.tmpdir(), "dxdy-public-gate-"));
try {
  const runtime = path.join(temp, "runtime.env");
  writeFileSync(runtime, "APP_MASTER_KEY=" + "0".repeat(64) + "\n", {
    mode: 0o600,
  });
  const env = {
    ...process.env,
    DXDY_COMPOSE_PROJECT: "dx-dy-gate",
    DXDY_IMAGE_REFERENCE: "example.invalid/dx-dy:0.1.8",
    DXDY_RUNTIME_ENV: runtime,
    DXDY_DATA_DIR: path.join(temp, "data"),
    DXDY_BACKUP_DIR: path.join(temp, "backups"),
    DXDY_CADDYFILE: path.resolve("deploy/Caddyfile.single"),
    DXDY_CADDY_DATA: path.join(temp, "caddy-data"),
    DXDY_CADDY_CONFIG: path.join(temp, "caddy-config"),
  };
  execFileSync(
    "docker",
    ["compose", "-f", "deploy/docker-compose.yml", "config", "--quiet"],
    {
      env,
      stdio: "inherit",
    },
  );
  for (const mode of ["single", "dual"]) {
    const candidate = path.join(temp, `Caddyfile.${mode}`);
    writeFileSync(
      candidate,
      readFileSync(`deploy/Caddyfile.${mode}`, "utf8")
        .replaceAll("__ADMIN_DOMAIN__", "panel.example.com")
        .replaceAll("__SUBSCRIPTION_DOMAIN__", "sub.example.com"),
    );
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${candidate}:/etc/caddy/Caddyfile:ro`,
        "caddy:2.10.2-alpine",
        "caddy",
        "validate",
        "--config",
        "/etc/caddy/Caddyfile",
      ],
      { stdio: "inherit" },
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const identityFile = process.env.DXDY_PRIVATE_IDENTITIES_FILE;
if (identityFile) {
  if (
    path
      .resolve(identityFile)
      .startsWith(path.resolve(process.cwd()) + path.sep)
  )
    throw new Error(
      "Private identity file must be outside the public repository",
    );
  const identities = JSON.parse(readFileSync(identityFile, "utf8"));
  if (
    !Array.isArray(identities) ||
    identities.some((value) => typeof value !== "string" || value.length < 7)
  )
    throw new Error("Invalid private identity file");
  const objects = execFileSync(
    "git",
    ["cat-file", "--batch-all-objects", "--batch"],
    {
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (identities.some((value) => objects.includes(Buffer.from(value))))
    throw new Error("Known production identity remains in Git objects");
  console.log("Known private deployment identity object scan: PASS");
}
console.log("PUBLIC RELEASE GATE: PASS");
