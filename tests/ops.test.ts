import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temp(prefix = "dxdy-ops-test-") {
  const root = mkdtempSync(path.join("/tmp", prefix));
  roots.push(root);
  return root;
}

function install(osId: string, version: string, arch: string, dual: boolean) {
  const root = temp();
  const osRelease = path.join(root, "os-release");
  const password = path.join(root, "password");
  writeFileSync(osRelease, `ID=${osId}\nVERSION_ID="${version}"\n`);
  writeFileSync(password, "Synthetic-installer-password-123!\n", {
    mode: 0o600,
  });
  const result = spawnSync("bash", ["install.sh"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DXDY_TEST_MODE: "1",
      DXDY_ROOT_PREFIX: root,
      DXDY_OS_RELEASE_FILE: osRelease,
      DXDY_ARCH: arch,
      DXDY_ADMIN_DOMAIN: "panel.example.com",
      DXDY_SUBSCRIPTION_DOMAIN: dual ? "sub.example.com" : "panel.example.com",
      DXDY_ADMIN_USERNAME: "operator",
      DXDY_ADMIN_PASSWORD_FILE: password,
    },
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return root;
}

describe("public installer", () => {
  it.each([
    ["debian", "12", "amd64"],
    ["debian", "12", "arm64"],
    ["ubuntu", "22.04", "amd64"],
    ["ubuntu", "22.04", "arm64"],
    ["ubuntu", "24.04", "amd64"],
    ["ubuntu", "24.04", "arm64"],
  ])("generates isolated config for %s %s %s", (osId, version, arch) => {
    const root = install(osId, version, arch, arch === "arm64");
    const config = path.join(root, "etc/dx-dy");
    expect(statSync(path.join(config, "install.conf")).mode & 0o777).toBe(
      0o600,
    );
    expect(statSync(path.join(config, "runtime.env")).mode & 0o777).toBe(0o600);
    expect(
      readFileSync(path.join(config, "runtime.env"), "utf8"),
    ).not.toContain("Synthetic-installer-password");
    const caddy = readFileSync(path.join(config, "Caddyfile"), "utf8");
    expect(caddy).toContain("panel.example.com");
    if (arch === "arm64") {
      expect(caddy).toContain("sub.example.com");
      expect(caddy).toContain("@subscription path /s/* /health");
      expect(caddy).toContain("respond 404");
    } else {
      expect(caddy.match(/panel\.example\.com/g)).toHaveLength(1);
    }
    expect(existsSync(path.join(root, "usr/local/bin/dx-dy"))).toBe(true);
  });

  it("fails closed on an existing install", () => {
    const root = install("debian", "12", "amd64", false);
    const result = spawnSync("bash", ["install.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DXDY_TEST_MODE: "1",
        DXDY_ROOT_PREFIX: root,
        DXDY_OS_RELEASE_FILE: path.join(root, "os-release"),
        DXDY_ARCH: "amd64",
      },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already installed");
  });
});

function managerFixture() {
  const root = temp();
  const config = path.join(root, "config");
  const installRoot = path.join(root, "install");
  const data = path.join(root, "data");
  const backups = path.join(root, "backups");
  const bin = path.join(root, "bin");
  mkdirSync(config);
  mkdirSync(installRoot);
  mkdirSync(data);
  mkdirSync(backups);
  mkdirSync(bin);
  writeFileSync(path.join(installRoot, "docker-compose.yml"), "services: {}\n");
  writeFileSync(
    path.join(installRoot, "Caddyfile.single"),
    "__ADMIN_DOMAIN__ { reverse_proxy app:3000 }\n",
  );
  writeFileSync(
    path.join(installRoot, "Caddyfile.dual"),
    "__ADMIN_DOMAIN__ { reverse_proxy app:3000 }\n__SUBSCRIPTION_DOMAIN__ { @subscription path /s/* /health\nhandle @subscription { reverse_proxy app:3000 }\nrespond 404\n}\n",
  );
  writeFileSync(
    path.join(config, "Caddyfile"),
    "panel.example.com { reverse_proxy app:3000 }\n",
  );
  writeFileSync(
    path.join(config, "runtime.env"),
    "ADMIN_BASE_URL=https://panel.example.com\nSUBSCRIPTION_BASE_URL=https://panel.example.com\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(config, "install.conf"),
    [
      "DXDY_VERSION=0.1.8",
      "DXDY_REPOSITORY=example/dx-dy",
      `DXDY_INSTALL_ROOT=${installRoot}`,
      `DXDY_CONFIG_DIR=${config}`,
      `DXDY_DATA_DIR=${data}`,
      `DXDY_BACKUP_DIR=${backups}`,
      "DXDY_COMPOSE_PROJECT=dx-dy-test",
      "DXDY_IMAGE_REFERENCE=example.invalid/dx-dy:0.1.8",
      "DXDY_IMAGE_DIGEST=sha256:synthetic",
      "DXDY_CADDY_IMAGE=caddy:2.10.2-alpine",
      `DXDY_CADDYFILE=${path.join(config, "Caddyfile")}`,
      `DXDY_CADDY_DATA=${path.join(data, "caddy-data")}`,
      `DXDY_CADDY_CONFIG=${path.join(data, "caddy-config")}`,
      `DXDY_RUNTIME_ENV=${path.join(config, "runtime.env")}`,
      "DXDY_ADMIN_DOMAIN=panel.example.com",
      "DXDY_SUBSCRIPTION_DOMAIN=panel.example.com",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const calls = path.join(root, "calls");
  writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' "$*" >>"${calls}"\nif [[ "\${DXDY_FORCE_COMPOSE_V1:-0}" == 1 && "$1" == compose ]]; then exit 1; fi\nif [[ "$1" == info ]]; then exit 0; fi\nif [[ "$1" == run ]]; then exit "\${DXDY_MOCK_DOCKER_RUN_STATUS:-0}"; fi\nif [[ "\${DXDY_MOCK_RELOAD_FAIL:-0}" == 1 && "$*" == *"caddy reload"* ]]; then exit 1; fi\nif [[ "$*" == *"node dist/database.mjs backup"* ]]; then file="\${*: -1}"; touch "${backups}/\${file##*/}"; fi\nif [[ "$*" == *"node dist/database.mjs bundle"* ]]; then file="\${*: -1}"; touch "${backups}/\${file##*/}"; fi\nif [[ "$*" == *" cat /tmp/"* ]]; then printf 'synthetic backup'; fi\nif [[ "$*" == *"fetch("* ]]; then [[ "\${DXDY_MOCK_HEALTH_FAIL:-0}" == 1 ]] && exit 1; printf '{"name":"dx-dy","status":"ok","database":"ok","version":"0.1.8"}\\n'; fi\nexit 0\n`,
    { mode: 0o755 },
  );
  chmodSync(path.join(bin, "docker"), 0o755);
  symlinkSync(path.join(bin, "docker"), path.join(bin, "docker-compose"));
  const managerPath = path.join(root, "installed-manager");
  writeFileSync(managerPath, "old manager\n", { mode: 0o755 });
  return { root, config, installRoot, data, backups, bin, calls, managerPath };
}

function manager(
  fixture: ReturnType<typeof managerFixture>,
  args: string[],
  input = "",
  extra: NodeJS.ProcessEnv = {},
) {
  return spawnSync("bash", ["ops/dx-dy", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      DXDY_CONFIG_DIR: fixture.config,
      DXDY_ALLOW_TEST_PATHS: "1",
      DXDY_MANAGER_PATH: fixture.managerPath,
      ...extra,
    },
    input,
    encoding: "utf8",
  });
}

describe("dx-dy manager", () => {
  it("routes lifecycle, admin and backup operations without credential argv", () => {
    const fixture = managerFixture();
    expect(manager(fixture, ["status"]).status).toBe(0);
    expect(manager(fixture, ["start"]).status).toBe(0);
    expect(manager(fixture, ["stop"]).status).toBe(0);
    expect(manager(fixture, ["restart"]).status).toBe(0);
    expect(
      manager(
        fixture,
        ["admin", "reset-password"],
        "Synthetic-new-password-123!\nSynthetic-new-password-123!\n",
      ).status,
    ).toBe(0);
    expect(manager(fixture, ["backup", "db"]).status).toBe(0);
    const calls = readFileSync(fixture.calls, "utf8");
    expect(calls).toContain("compose");
    expect(calls).not.toContain("Synthetic-new-password");
    expect(
      readFileSync(fixture.config + "/install.conf", "utf8"),
    ).not.toContain("Synthetic-new-password");
  });

  it("validates domain candidates and rolls back a failed Caddy reload", () => {
    const fixture = managerFixture();
    const before = readFileSync(path.join(fixture.config, "Caddyfile"), "utf8");
    const result = manager(
      fixture,
      ["domain", "set-subscription", "sub.example.com"],
      "",
      { DXDY_MOCK_DOCKER_RUN_STATUS: "0" },
    );
    expect(result.status).toBe(0);
    expect(
      readFileSync(path.join(fixture.config, "Caddyfile"), "utf8"),
    ).toContain("sub.example.com");
    const acceptedCaddy = readFileSync(
      path.join(fixture.config, "Caddyfile"),
      "utf8",
    );
    const acceptedConfig = readFileSync(
      path.join(fixture.config, "install.conf"),
      "utf8",
    );
    const failed = manager(
      fixture,
      ["domain", "set-admin", "next.example.com"],
      "",
      { DXDY_MOCK_RELOAD_FAIL: "1" },
    );
    expect(failed.status).not.toBe(0);
    expect(readFileSync(path.join(fixture.config, "Caddyfile"), "utf8")).toBe(
      acceptedCaddy,
    );
    expect(
      readFileSync(path.join(fixture.config, "install.conf"), "utf8"),
    ).toBe(acceptedConfig);
    const invalid = manager(fixture, [
      "domain",
      "set-admin",
      "https://bad/path",
    ]);
    expect(invalid.status).not.toBe(0);
    expect(
      readFileSync(path.join(fixture.config, "Caddyfile"), "utf8"),
    ).not.toBe(before);
  });

  it("verifies local release assets, updates atomically and rolls back health failure", () => {
    const makeRelease = (fixture: ReturnType<typeof managerFixture>) => {
      const release = path.join(fixture.root, "release");
      mkdirSync(release);
      const assets: Record<string, string> = {
        "dx-dy": "#!/usr/bin/env bash\necho updated-manager\n",
        "docker-compose.yml": readFileSync(
          path.join(fixture.installRoot, "docker-compose.yml"),
          "utf8",
        ),
        "Caddyfile.single": "__ADMIN_DOMAIN__ { reverse_proxy app:3000 }\n",
        "Caddyfile.dual":
          "__ADMIN_DOMAIN__ { reverse_proxy app:3000 }\n__SUBSCRIPTION_DOMAIN__ { respond 404 }\n",
      };
      for (const [name, content] of Object.entries(assets))
        writeFileSync(path.join(release, name), content);
      const hash = (name: string) =>
        createHash("sha256")
          .update(readFileSync(path.join(release, name)))
          .digest("hex");
      writeFileSync(
        path.join(release, "release.json"),
        JSON.stringify({ tag_name: "v0.1.9" }),
      );
      writeFileSync(
        path.join(release, "release-manifest.json"),
        JSON.stringify({
          version: "0.1.9",
          docker_image: "ghcr.io/example/dx-dy",
          docker_image_digest: `sha256:${"1".repeat(64)}`,
          manager_sha256: hash("dx-dy"),
          compose_sha256: hash("docker-compose.yml"),
          caddy_single_sha256: hash("Caddyfile.single"),
          caddy_dual_sha256: hash("Caddyfile.dual"),
        }),
      );
      return release;
    };

    const successful = managerFixture();
    const release = makeRelease(successful);
    const result = manager(successful, ["update"], "y\n", {
      DXDY_UPDATE_MOCK_DIR: release,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(successful.managerPath, "utf8")).toContain(
      "updated-manager",
    );
    expect(
      readFileSync(path.join(successful.config, "install.conf"), "utf8"),
    ).toContain("DXDY_VERSION=0.1.9");

    const failed = managerFixture();
    const failedRelease = makeRelease(failed);
    const before = readFileSync(
      path.join(failed.config, "install.conf"),
      "utf8",
    );
    const failedResult = manager(failed, ["update"], "y\n", {
      DXDY_UPDATE_MOCK_DIR: failedRelease,
      DXDY_MOCK_HEALTH_FAIL: "1",
    });
    expect(failedResult.status).not.toBe(0);
    expect(readFileSync(path.join(failed.config, "install.conf"), "utf8")).toBe(
      before,
    );
    expect(readFileSync(failed.managerPath, "utf8")).toBe("old manager\n");
  });

  it("preserves data by default and requires DELETE for a full purge", () => {
    const preserved = managerFixture();
    expect(manager(preserved, ["uninstall"], "1\n").status).toBe(0);
    expect(existsSync(preserved.installRoot)).toBe(false);
    expect(existsSync(preserved.config)).toBe(false);
    expect(existsSync(preserved.data)).toBe(true);
    expect(existsSync(preserved.backups)).toBe(true);

    const cancelled = managerFixture();
    expect(manager(cancelled, ["uninstall"], "2\nNO\n").status).not.toBe(0);
    expect(existsSync(cancelled.data)).toBe(true);
    expect(existsSync(cancelled.backups)).toBe(true);

    const purged = managerFixture();
    expect(manager(purged, ["uninstall"], "2\nDELETE\n").status).toBe(0);
    expect(existsSync(purged.installRoot)).toBe(false);
    expect(existsSync(purged.config)).toBe(false);
    expect(existsSync(purged.data)).toBe(false);
    expect(existsSync(purged.backups)).toBe(false);
  });

  it("wraps portable and full restores with backup, stop, health and stdin secrets", () => {
    const portable = managerFixture();
    const db = path.join(portable.backups, "portable.db");
    writeFileSync(db, "synthetic");
    expect(manager(portable, ["restore", db]).status).toBe(0);
    expect(readFileSync(portable.calls, "utf8")).toContain(
      "dist/database.mjs restore /backups/portable.db",
    );

    const full = managerFixture();
    const bundle = path.join(full.backups, "migration.psmbackup");
    writeFileSync(bundle, "synthetic");
    expect(
      manager(
        full,
        ["restore", bundle],
        "Synthetic-backup-password-123!\nSynthetic-backup-password-123!\n",
      ).status,
    ).toBe(0);
    const calls = readFileSync(full.calls, "utf8");
    expect(calls).toContain("INSTANCE_ENV_FILE=/run/dx-dy/runtime.env");
    expect(calls).not.toContain("Synthetic-backup-password");
  });

  it("recognizes a legacy source path for status, restart, logs, backup and doctor", () => {
    const fixture = managerFixture();
    writeFileSync(
      path.join(fixture.installRoot, ".env"),
      [
        "ADMIN_BASE_URL=https://panel.example.com",
        "SUBSCRIPTION_BASE_URL=https://sub.example.com",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(fixture.installRoot, "package.json"),
      JSON.stringify({ version: "0.1.8" }),
    );
    const legacyEnv = {
      DXDY_CONFIG_DIR: path.join(fixture.root, "missing-config"),
      DXDY_LEGACY_ROOT: fixture.installRoot,
      DXDY_FORCE_COMPOSE_V1: "1",
    };
    expect(manager(fixture, ["status"], "", legacyEnv).stdout).toContain(
      "Mode: legacy",
    );
    expect(manager(fixture, ["restart"], "", legacyEnv).status).toBe(0);
    expect(manager(fixture, ["logs", "app", "20"], "", legacyEnv).status).toBe(
      0,
    );
    expect(manager(fixture, ["backup", "db"], "", legacyEnv).status).toBe(0);
    expect(manager(fixture, ["doctor"], "", legacyEnv).status).toBe(0);
    const legacyBackups = path.join(fixture.installRoot, "data/backups");
    expect(existsSync(legacyBackups)).toBe(true);
    expect(
      readdirSync(legacyBackups).some((name) => name.endsWith(".db")),
    ).toBe(true);
    const backup = readdirSync(legacyBackups).find((name) =>
      name.endsWith(".db"),
    );
    expect(statSync(path.join(legacyBackups, backup!)).size).toBeGreaterThan(0);
  });
});
