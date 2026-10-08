import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const version = metadata.version;
const commit =
  process.env.RELEASE_GIT_COMMIT ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const image = process.env.RELEASE_DOCKER_IMAGE || "";
const digest = process.env.RELEASE_DOCKER_DIGEST || "";
const repository = process.env.RELEASE_REPOSITORY || "";
if (!/^ghcr\.io\/[a-z0-9_.-]+\/dx-dy$/.test(image))
  throw new Error("RELEASE_DOCKER_IMAGE must be the final GHCR repository");
if (!/^sha256:[a-f0-9]{64}$/.test(digest))
  throw new Error("RELEASE_DOCKER_DIGEST must be a sha256 digest");
if (!/^[A-Za-z0-9_.-]+\/dx-dy$/.test(repository))
  throw new Error("RELEASE_REPOSITORY must identify the dx-dy repository");
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid Git commit");

mkdirSync("dist/release", { recursive: true });
const assets = [
  ["install.sh", "install.sh"],
  ["ops/dx-dy", "dx-dy"],
  ["deploy/docker-compose.yml", "docker-compose.yml"],
  ["deploy/Caddyfile.single", "Caddyfile.single"],
  ["deploy/Caddyfile.dual", "Caddyfile.dual"],
  ["dist/source.tar.gz", `dx-dy-${version}-source.tar.gz`],
];
const hashes = {};
for (const [source, name] of assets) {
  const target = path.join("dist/release", name);
  copyFileSync(source, target);
  hashes[name] = createHash("sha256")
    .update(readFileSync(target))
    .digest("hex");
}
const createdAt = process.env.RELEASE_CREATED_AT || new Date().toISOString();
const manifest = {
  version,
  repository,
  git_commit: commit,
  source_sha256: hashes[`dx-dy-${version}-source.tar.gz`],
  installer_sha256: hashes["install.sh"],
  manager_sha256: hashes["dx-dy"],
  compose_sha256: hashes["docker-compose.yml"],
  caddy_single_sha256: hashes["Caddyfile.single"],
  caddy_dual_sha256: hashes["Caddyfile.dual"],
  docker_image: image,
  docker_image_digest: digest,
  supported_architectures: ["linux/amd64", "linux/arm64"],
  minimum_schema_version: "001_initial.sql",
  backup_format_compatibility: ["portable-sqlite", "psmbackup-v1"],
  created_at: createdAt,
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
console.log(`Release assets prepared for dx-dy ${version} (${commit}).`);
