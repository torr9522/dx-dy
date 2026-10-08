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
  "deploy/native/dx-dy.service",
  "deploy/native/Caddyfile.single",
  "deploy/native/Caddyfile.dual",
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
if (metadata.name !== "dx-dy" || metadata.version !== "0.2.0")
  throw new Error("Public brand/version mismatch");
if (!readFileSync("README.md", "utf8").startsWith("# dx-dy 0.2.0"))
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
if (
  installer.includes("$SCRIPT_DIR/ops/dx-dy") ||
  !installer.includes("manager_sha256") ||
  !installer.includes("Manager checksum failed")
)
  throw new Error("Public installer manager delivery is not release-native");
const agentGuide = readFileSync("AGENTS.md", "utf8");
const baseline = readFileSync("docs/CURRENT_BASELINE.md", "utf8");
const capabilities = readFileSync("docs/CAPABILITY_TREE.md", "utf8");
for (const [label, content, terms] of [
  [
    "agent guide",
    agentGuide,
    ["NO AUTO SUBSCRIPTION", "0.2.0", "pnpm release:check --full --public"],
  ],
  [
    "current baseline",
    baseline,
    [
      "001_initial.sql",
      "002_node_collections.sql",
      "Migration in 0.2.0: **NONE**",
    ],
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
  (file) =>
    file === "AGENTS.md" || file === "README.md" || file.endsWith(".md"),
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
if (
  /ghcr|docker\/login-action|build-push-action|packages:\s*write/i.test(
    releaseWorkflow,
  )
)
  throw new Error("Native release workflow must not publish or require GHCR");
execFileSync("shellcheck", ["-x", "install.sh", "ops/dx-dy"], {
  stdio: "inherit",
});
const unit = readFileSync("deploy/native/dx-dy.service", "utf8");
for (const term of [
  "User=dx-dy",
  "EnvironmentFile=/etc/dx-dy/dx-dy.env",
  "ExecStart=/opt/dx-dy/current/runtime/bin/node",
  "Restart=on-failure",
  "NoNewPrivileges=true",
])
  if (!unit.includes(term)) throw new Error(`Incomplete systemd unit: ${term}`);
const unitTemp = mkdtempSync(path.join(os.tmpdir(), "dxdy-systemd-"));
try {
  const candidate = path.join(unitTemp, "dx-dy.service");
  writeFileSync(
    candidate,
    unit
      .replace("User=dx-dy", "User=root")
      .replace("Group=dx-dy", "Group=root")
      .replace(/^ExecStart=.*$/m, "ExecStart=/bin/true"),
  );
  execFileSync("systemd-analyze", ["verify", candidate], {
    stdio: "inherit",
  });
} finally {
  rmSync(unitTemp, { recursive: true, force: true });
}
for (const mode of ["single", "dual"]) {
  const caddy = readFileSync(`deploy/native/Caddyfile.${mode}`, "utf8");
  if (
    !caddy.includes("127.0.0.1:__INTERNAL_PORT__") ||
    caddy.includes("app:3000")
  )
    throw new Error(`Invalid native Caddy template: ${mode}`);
}
for (const file of ["install.sh", "ops/dx-dy"]) {
  const content = readFileSync(file, "utf8");
  if (/podman|nerdctl|ghcr\.io/i.test(content))
    throw new Error(
      `Native entrypoint has a container runtime dependency: ${file}`,
    );
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
