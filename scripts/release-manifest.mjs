import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const version = metadata.version;
const nodeVersion = metadata.engines.node.replace(/\.x$/, ".0");
const commit =
  process.env.RELEASE_GIT_COMMIT ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const repository = process.env.RELEASE_REPOSITORY || "torr9522/dx-dy";
if (!/^[A-Za-z0-9_.-]+\/dx-dy$/.test(repository))
  throw new Error("Invalid dx-dy repository coordinate");
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid Git commit");

mkdirSync("dist/release", { recursive: true });
const files = [
  ["install.sh", "install.sh"],
  ["ops/dx-dy", "dx-dy"],
  ["dist/source.tar.gz", `dx-dy-${version}-source.tar.gz`],
  [
    process.env.DXDY_AMD64_ARTIFACT ||
      `dist/native/dx-dy-${version}-linux-amd64.tar.gz`,
    `dx-dy-${version}-linux-amd64.tar.gz`,
  ],
  [
    process.env.DXDY_ARM64_ARTIFACT ||
      `dist/native/dx-dy-${version}-linux-arm64.tar.gz`,
    `dx-dy-${version}-linux-arm64.tar.gz`,
  ],
];
const hashes = {};
for (const [source, name] of files) {
  if (!existsSync(source)) throw new Error(`Missing release input: ${source}`);
  const target = path.join("dist/release", name);
  copyFileSync(source, target);
  hashes[name] = createHash("sha256")
    .update(readFileSync(target))
    .digest("hex");
}
const artifactNames = [
  `dx-dy-${version}-linux-amd64.tar.gz`,
  `dx-dy-${version}-linux-arm64.tar.gz`,
];
const manifest = {
  version,
  repository,
  git_commit: commit,
  release_model: "native-systemd",
  supported_os: ["debian-12", "ubuntu-22.04", "ubuntu-24.04"],
  architectures: ["amd64", "arm64"],
  node_runtime_version: nodeVersion,
  artifacts: artifactNames.map((name) => ({
    name,
    architecture: name.includes("amd64") ? "amd64" : "arm64",
    sha256: hashes[name],
  })),
  source: {
    name: `dx-dy-${version}-source.tar.gz`,
    sha256: hashes[`dx-dy-${version}-source.tar.gz`],
  },
  source_sha256: hashes[`dx-dy-${version}-source.tar.gz`],
  installer_sha256: hashes["install.sh"],
  manager_sha256: hashes["dx-dy"],
  minimum_schema: "001_initial.sql",
  current_schema: "002_node_collections.sql",
  backup_format_compatibility: ["portable-sqlite", "psmbackup-v1"],
  created_at: process.env.RELEASE_CREATED_AT || new Date().toISOString(),
};
writeFileSync(
  "dist/release/release-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
hashes["release-manifest.json"] = createHash("sha256")
  .update(readFileSync("dist/release/release-manifest.json"))
  .digest("hex");
writeFileSync(
  "dist/release/SHA256SUMS",
  Object.entries(hashes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n") + "\n",
);
console.log(`Native release assets prepared for dx-dy ${version} (${commit}).`);
