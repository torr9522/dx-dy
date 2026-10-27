import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const version = metadata.version;
const expectedManager = `dx-dy ${version}`;
const expectedInstaller = `dx-dy installer ${version}`;
const text = (file) => readFileSync(file, "utf8");
const run = (file, args) =>
  execFileSync(file, args, { encoding: "utf8" }).trim();
const requireText = (file, value) => {
  if (!text(file).includes(value))
    throw new Error(`Version identity mismatch in ${file}`);
};

if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Invalid package version identity");
requireText("ops/dx-dy", `DXDY_MANAGER_VERSION="${version}"`);
requireText("install.sh", `DXDY_VERSION="${version}"`);
requireText("deploy/native/install.conf.example", `DXDY_VERSION=${version}`);
requireText("apps/api/src/app.ts", `version: "${version}"`);
requireText("apps/api/src/main.ts", `version: "${version}"`);
requireText("scripts/database.ts", `const version = "${version}"`);
if (run("bash", ["ops/dx-dy", "version"]) !== expectedManager)
  throw new Error("Manager executable version identity mismatch");
if (run("bash", ["install.sh", "--version"]) !== expectedInstaller)
  throw new Error("Installer executable version identity mismatch");
console.log(`VERSION-ID-001 source/package: ${version}`);
console.log(`VERSION-ID-002 manager: ${version}`);
console.log(`VERSION-ID-003 installer: ${version}`);

if (process.argv.includes("--assets")) {
  const releaseDir = path.resolve("dist/release");
  const manifestFile = path.join(releaseDir, "release-manifest.json");
  if (!existsSync(manifestFile)) throw new Error("Release manifest is missing");
  const manifest = JSON.parse(text(manifestFile));
  if (manifest.version !== version)
    throw new Error("Release manifest version identity mismatch");
  if (run(path.join(releaseDir, "dx-dy"), ["version"]) !== expectedManager)
    throw new Error("Published manager version identity mismatch");
  if (
    run("bash", [path.join(releaseDir, "install.sh"), "--version"]) !==
    expectedInstaller
  )
    throw new Error("Published installer version identity mismatch");

  const sums = new Map(
    text(path.join(releaseDir, "SHA256SUMS"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})  (.+)$/);
        if (!match) throw new Error("Invalid SHA256SUMS entry");
        return [match[2], match[1]];
      }),
  );
  for (const name of [
    "install.sh",
    "dx-dy",
    `dx-dy-${version}-source.tar.gz`,
    `dx-dy-${version}-linux-amd64.tar.gz`,
    `dx-dy-${version}-linux-arm64.tar.gz`,
    "release-manifest.json",
  ]) {
    const digest = createHash("sha256")
      .update(readFileSync(path.join(releaseDir, name)))
      .digest("hex");
    if (sums.get(name) !== digest)
      throw new Error(`Release checksum identity mismatch: ${name}`);
  }

  const temp = mkdtempSync(path.join(os.tmpdir(), "dxdy-version-identity-"));
  try {
    for (const architecture of ["amd64", "arm64"]) {
      const artifact = path.join(
        releaseDir,
        `dx-dy-${version}-linux-${architecture}.tar.gz`,
      );
      execFileSync("tar", ["-xzf", artifact, "-C", temp]);
      const release = JSON.parse(
        text(
          path.join(
            temp,
            `dx-dy-${version}-linux-${architecture}`,
            "RELEASE.json",
          ),
        ),
      );
      if (
        release.version !== version ||
        release.architecture !== architecture ||
        release.git_commit !== manifest.git_commit
      )
        throw new Error(`${architecture} RELEASE.json identity mismatch`);
    }
    const sourceArchive = path.join(
      releaseDir,
      `dx-dy-${version}-source.tar.gz`,
    );
    const sourceMetadata = JSON.parse(
      execFileSync("tar", ["-xOf", sourceArchive, "package.json"], {
        encoding: "utf8",
      }),
    );
    if (sourceMetadata.version !== version)
      throw new Error("Source archive version identity mismatch");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  const tag = process.env.GITHUB_REF_NAME;
  if (tag && tag !== `v${version}`)
    throw new Error("Release tag version identity mismatch");
  console.log(`VERSION-ID-004 manifest: ${version}`);
  console.log(`VERSION-ID-005 RELEASE.json: ${version}`);
  console.log(`VERSION-ID-006 native runtime identity: ${version}`);
  console.log(`VERSION-ID-007 release asset/tag: ${version}`);
  console.log(`VERSION-ID-008 source archive: ${version}`);
}
