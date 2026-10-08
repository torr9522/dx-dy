import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const metadata = JSON.parse(readFileSync("package.json", "utf8"));
const version = metadata.version;
const requested = process.argv[2];
if (requested && !new Set(["amd64", "arm64"]).has(requested))
  throw new Error("Usage: node scripts/native-release-check.mjs [amd64|arm64]");
for (const arch of requested ? [requested] : ["amd64", "arm64"]) {
  const artifact = path.resolve(
    "dist/native",
    `dx-dy-${version}-linux-${arch}.tar.gz`,
  );
  if (!existsSync(artifact))
    throw new Error(`Missing native artifact: ${artifact}`);
  const temp = mkdtempSync(path.join(os.tmpdir(), `dxdy-native-${arch}-`));
  try {
    execFileSync("tar", ["-xzf", artifact, "-C", temp]);
    const root = path.join(temp, `dx-dy-${version}-linux-${arch}`);
    for (const item of [
      "runtime/bin/node",
      "app/dist/server.mjs",
      "app/dist/database.mjs",
      "app/dist/admin-cli.mjs",
      "app/node_modules/argon2",
      "app/migrations/001_initial.sql",
      "app/migrations/002_node_collections.sql",
      "dx-dy.service",
      "Caddyfile.single",
      "Caddyfile.dual",
      "RELEASE.json",
    ])
      if (!existsSync(path.join(root, item)))
        throw new Error(`${arch} artifact missing ${item}`);
    const release = JSON.parse(
      readFileSync(path.join(root, "RELEASE.json"), "utf8"),
    );
    if (
      release.version !== version ||
      release.architecture !== arch ||
      release.release_model !== "native-systemd"
    )
      throw new Error(`${arch} release metadata mismatch`);
    const expectedAddon =
      arch === "amd64"
        ? "app/node_modules/argon2/prebuilds/linux-x64/argon2.glibc.node"
        : "app/node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.glibc.node";
    if (!existsSync(path.join(root, expectedAddon)))
      throw new Error(`${arch} Argon2 native addon is missing`);
    const otherAddonDirectory =
      arch === "amd64"
        ? "app/node_modules/argon2/prebuilds/linux-arm64"
        : "app/node_modules/argon2/prebuilds/linux-x64";
    if (existsSync(path.join(root, otherAddonDirectory)))
      throw new Error(`${arch} artifact contains the other architecture addon`);
    if (arch === (process.arch === "x64" ? "amd64" : process.arch))
      execFileSync(
        path.join(root, "runtime/bin/node"),
        ["-e", "import('argon2').then(()=>console.log(process.version))"],
        { cwd: path.join(root, "app"), stdio: "inherit" },
      );
    else if (requested)
      throw new Error(
        `Cannot execute ${arch} artifact on ${process.arch} runner`,
      );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
console.log("NATIVE ARTIFACT CHECK: PASS");
