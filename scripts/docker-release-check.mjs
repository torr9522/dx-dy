// Isolated release smoke; never invokes production Compose or uses real credentials.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const commit = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(commit || ""))
  throw new Error("Supply tested commit SHA");
const suffix = randomBytes(6).toString("hex");
const image = "psm-release-check:" + suffix;
const name = "psm-release-check-" + suffix;
const volume = name + "-data";
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
const env = {
  ...process.env,
  APP_MASTER_KEY: randomBytes(32).toString("hex"),
  ADMIN_INITIAL_PASSWORD: randomBytes(24).toString("base64url"),
};
const productVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const migrationCount = readdirSync("migrations").filter((file) =>
  file.endsWith(".sql"),
).length;
const cleanup = (...args) => spawnSync("docker", args, { stdio: "ignore" });
try {
  execFileSync(
    "docker",
    [
      "build",
      "--no-cache",
      "--label",
      "org.opencontainers.image.revision=" + commit,
      "-t",
      image,
      ".",
    ],
    { stdio: "inherit" },
  );
  docker("volume", "create", volume);
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "-v",
      volume + ":/data",
      "-e",
      "APP_MASTER_KEY",
      "-e",
      "ADMIN_INITIAL_PASSWORD",
      "-e",
      "PUBLIC_BASE_URL=http://localhost",
      "-e",
      "COOKIE_SECURE=false",
      image,
    ],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  const probe = () =>
    docker(
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      'const r=await fetch("http://127.0.0.1:3000/health");if(!r.ok)process.exit(1);const j=await r.json();if(j.status!=="ok"||j.database!=="ok"||j.version!==process.argv[1])process.exit(1);',
      productVersion,
    );
  const wait = async () => {
    for (let i = 0; i < 40; i++) {
      try {
        probe();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error("Isolated container health failed");
  };
  await wait();
  docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    'import {DatabaseSync} from "node:sqlite";const d=new DatabaseSync(process.env.DATABASE_PATH);if(d.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")process.exit(1);if(d.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n!==Number(process.argv[1]))process.exit(1);d.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run("release_probe",JSON.stringify("synthetic"));',
    String(migrationCount),
  );
  docker(
    "exec",
    name,
    "node",
    "dist/backup.mjs",
    "/data/backups/release.sqlite",
  );
  docker("restart", name);
  await wait();
  docker(
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    'import {DatabaseSync} from "node:sqlite";for(const file of [process.env.DATABASE_PATH,"/data/backups/release.sqlite"]){const d=new DatabaseSync(file);if(d.prepare("PRAGMA integrity_check").get().integrity_check!=="ok"||JSON.parse(d.prepare("SELECT value FROM settings WHERE key=?").get("release_probe").value)!=="synthetic")process.exit(1);}',
  );
  assert.equal(
    docker("inspect", "--format", "{{.Config.User}}", name).trim(),
    "node",
  );
  const health = () =>
    docker("inspect", "--format", "{{.State.Health.Status}}", name).trim();
  for (let i = 0; i < 40 && health() !== "healthy"; i++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(health(), "healthy");
  console.log(
    "No-cache Docker build + isolated healthcheck/migration/backup/integrity/restart/persistence: PASS; commit=" +
      commit,
  );
} finally {
  cleanup("rm", "-f", name);
  cleanup("volume", "rm", volume);
  cleanup("image", "rm", image);
}
