import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const version = metadata.version;
const nodeVersion = metadata.engines.node.replace(/\.x$/, ".0");
const requested = process.argv[2] || process.env.DXDY_TARGET_ARCH;
const arch = requested || (process.arch === "x64" ? "amd64" : process.arch);
if (!new Set(["amd64", "arm64"]).has(arch))
  throw new Error(
    "Usage: node scripts/build-native-artifact.mjs <amd64|arm64>",
  );
if (!existsSync("dist/server.mjs") || !existsSync("node_modules/argon2"))
  throw new Error("Run pnpm build and pnpm install before packaging");

const nodeArch = arch === "amd64" ? "x64" : "arm64";
const runtimeName = `node-v${nodeVersion}-linux-${nodeArch}`;
const runtimeArchive = `${runtimeName}.tar.xz`;
const base =
  process.env.NODE_DIST_BASE_URL || `https://nodejs.org/dist/v${nodeVersion}`;
const output = path.resolve(process.env.DXDY_NATIVE_OUTPUT || "dist/native");
const temporary = path.join(output, `.stage-${arch}`);
const root = path.join(temporary, `dx-dy-${version}-linux-${arch}`);
mkdirSync(output, { recursive: true });
rmSync(temporary, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const deployment = path.join(root, "app");
execFileSync(
  "pnpm",
  [
    "deploy",
    "--prod",
    `--cpu=${nodeArch}`,
    "--os=linux",
    "--libc=glibc",
    deployment,
  ],
  { stdio: "inherit" },
);
for (const entry of readdirSync(deployment))
  if (entry !== "node_modules")
    rmSync(path.join(deployment, entry), { recursive: true, force: true });
const argonPrebuilds = path.join(
  realpathSync(path.join(deployment, "node_modules/argon2")),
  "prebuilds",
);
const expectedArgonDirectory = arch === "amd64" ? "linux-x64" : "linux-arm64";
for (const entry of readdirSync(argonPrebuilds))
  if (entry !== expectedArgonDirectory)
    rmSync(path.join(argonPrebuilds, entry), { recursive: true, force: true });
for (const entry of readdirSync(
  path.join(argonPrebuilds, expectedArgonDirectory),
))
  if (!entry.endsWith(".glibc.node"))
    rmSync(path.join(argonPrebuilds, expectedArgonDirectory, entry), {
      force: true,
    });

const download = (url, target) =>
  execFileSync(
    "curl",
    ["-fsSL", "--proto", "=https", "--tlsv1.2", url, "-o", target],
    {
      stdio: "inherit",
    },
  );
const cache = path.join(
  process.env.DXDY_NODE_CACHE || path.join(os.tmpdir(), "dx-dy-node-runtime"),
  runtimeArchive,
);
mkdirSync(path.dirname(cache), { recursive: true });
if (!existsSync(cache)) download(`${base}/${runtimeArchive}`, cache);
const sums = execFileSync(
  "curl",
  ["-fsSL", "--proto", "=https", "--tlsv1.2", `${base}/SHASUMS256.txt`],
  { encoding: "utf8" },
);
const expected = sums
  .split("\n")
  .find((line) => line.endsWith(`  ${runtimeArchive}`))
  ?.split(/\s+/)[0];
const actual = createHash("sha256").update(readFileSync(cache)).digest("hex");
if (!expected || expected !== actual)
  throw new Error("Node runtime checksum verification failed");

execFileSync("tar", ["-xJf", cache, "-C", root], { stdio: "inherit" });
cpSync(path.join(root, runtimeName), path.join(root, "runtime"), {
  recursive: true,
});
rmSync(path.join(root, runtimeName), { recursive: true, force: true });
mkdirSync(path.join(root, "app/dist"), { recursive: true });
for (const item of [
  "server.mjs",
  "backup.mjs",
  "database.mjs",
  "admin-cli.mjs",
  "domain-cli.mjs",
  "source.tar.gz",
  "web",
])
  cpSync(path.join("dist", item), path.join(root, "app/dist", item), {
    recursive: true,
  });
for (const item of [
  "migrations",
  "package.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
])
  cpSync(item, path.join(root, "app", item), { recursive: true });
for (const item of ["dx-dy.service", "Caddyfile.single", "Caddyfile.dual"])
  cpSync(path.join("deploy/native", item), path.join(root, item));
writeFileSync(
  path.join(root, "RELEASE.json"),
  JSON.stringify(
    {
      name: "dx-dy",
      version,
      release_model: "native-systemd",
      architecture: arch,
      node_runtime_version: nodeVersion,
      git_commit:
        process.env.RELEASE_GIT_COMMIT ||
        execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    },
    null,
    2,
  ) + "\n",
);

const artifact = path.join(output, `dx-dy-${version}-linux-${arch}.tar.gz`);
rmSync(artifact, { force: true });
execFileSync(
  "tar",
  [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    artifact,
    "-C",
    temporary,
    path.basename(root),
  ],
  { stdio: "inherit" },
);
rmSync(temporary, { recursive: true, force: true });
console.log(artifact);
