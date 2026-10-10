import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temp() {
  const root = mkdtempSync("/tmp/dxdy-ops-test-");
  roots.push(root);
  return root;
}
function executable(file: string, body: string) {
  writeFileSync(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`);
  chmodSync(file, 0o755);
}

function freshInstall(
  osId: string,
  osVersion: string,
  arch: string,
  dual: boolean,
  existingCaddyfile?: string,
) {
  const root = temp();
  const osRelease = path.join(root, "os-release");
  const password = path.join(root, "password");
  writeFileSync(osRelease, `ID=${osId}\nVERSION_ID="${osVersion}"\n`);
  writeFileSync(password, "Synthetic-installer-password-123!\n", {
    mode: 0o600,
  });
  if (existingCaddyfile !== undefined) {
    mkdirSync(path.join(root, "etc/caddy"), { recursive: true });
    writeFileSync(path.join(root, "etc/caddy/Caddyfile"), existingCaddyfile);
  }
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

function singleFileFixture(
  managerDelivery: "asset" | "corrupt" | "fail" = "asset",
  runtimeFails = false,
) {
  const root = temp();
  const assets = path.join(root, "assets");
  const packageRoot = path.join(root, "package", "dx-dy-0.2.6-linux-amd64");
  const script = path.join(root, "install.sh");
  const password = path.join(root, "password");
  const bin = path.join(root, "bin");
  const installedManager = path.join(root, "usr/local/bin/dx-dy");
  const manager = "#!/usr/bin/env bash\nprintf 'release-manager\\n'\n";
  mkdirSync(path.join(packageRoot, "runtime/bin"), { recursive: true });
  mkdirSync(path.join(packageRoot, "app/dist"), { recursive: true });
  mkdirSync(assets);
  mkdirSync(bin);
  executable(
    path.join(packageRoot, "runtime/bin/node"),
    runtimeFails ? "exit 86" : "exit 0",
  );
  writeFileSync(path.join(packageRoot, "app/dist/server.mjs"), "");
  writeFileSync(
    path.join(packageRoot, "dx-dy.service"),
    "[Service]\nUser=dx-dy\nExecStart=/opt/dx-dy/current/runtime/bin/node /opt/dx-dy/current/app/dist/server.mjs\n",
  );
  writeFileSync(
    path.join(packageRoot, "Caddyfile.single"),
    "__ADMIN_DOMAIN__ { reverse_proxy 127.0.0.1:__INTERNAL_PORT__ }\n",
  );
  writeFileSync(
    path.join(packageRoot, "Caddyfile.dual"),
    "__ADMIN_DOMAIN__ { reverse_proxy 127.0.0.1:__INTERNAL_PORT__ }\n__SUBSCRIPTION_DOMAIN__ { respond 404 }\n",
  );
  writeFileSync(
    path.join(packageRoot, "RELEASE.json"),
    '{"version":"0.2.6","release_model":"native-systemd","architecture":"amd64"}\n',
  );
  const artifact = "dx-dy-0.2.6-linux-amd64.tar.gz";
  expect(
    spawnSync("tar", [
      "-czf",
      path.join(assets, artifact),
      "-C",
      path.dirname(packageRoot),
      path.basename(packageRoot),
    ]).status,
  ).toBe(0);
  const hash = (content: string | Buffer) =>
    createHash("sha256").update(content).digest("hex");
  writeFileSync(
    path.join(assets, "release-manifest.json"),
    JSON.stringify({
      version: "0.2.6",
      release_model: "native-systemd",
      architectures: ["amd64", "arm64"],
      artifacts: [
        {
          name: artifact,
          architecture: "amd64",
          sha256: hash(readFileSync(path.join(assets, artifact))),
        },
      ],
      manager_asset: "dx-dy",
      manager_sha256: hash(manager),
    }),
  );
  if (managerDelivery === "asset")
    writeFileSync(path.join(assets, "dx-dy"), manager);
  else {
    executable(
      path.join(bin, "curl"),
      `target=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -o ]]; then target="$2"; shift 2; else shift; fi
done
mkdir -p "$(dirname "$DXDY_EXISTING_MANAGER")"
printf '#!/bin/sh\\necho existing-manager\\n' >"$DXDY_EXISTING_MANAGER"
if [[ "$DXDY_CURL_BEHAVIOR" == fail ]]; then exit 22; fi
printf '#!/bin/sh\\necho corrupted-manager\\n' >"$target"`,
    );
  }
  writeFileSync(script, readFileSync("install.sh"));
  chmodSync(script, 0o755);
  writeFileSync(path.join(root, "os-release"), 'ID=debian\nVERSION_ID="12"\n');
  writeFileSync(password, "Synthetic-installer-password-123!\n", {
    mode: 0o600,
  });
  return {
    root,
    assets,
    script,
    password,
    bin,
    installedManager,
    manager,
    managerDelivery,
  };
}

function runSingleFile(
  fixture: ReturnType<typeof singleFileFixture>,
  processSubstitution = false,
) {
  const args = processSubstitution
    ? ["-c", 'bash <(/bin/cat "$1")', "dx-dy-installer", fixture.script]
    : [fixture.script];
  return spawnSync("bash", args, {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      DXDY_TEST_MODE: "1",
      DXDY_TEST_REAL_ARTIFACT: "1",
      DXDY_ROOT_PREFIX: fixture.root,
      DXDY_OS_RELEASE_FILE: path.join(fixture.root, "os-release"),
      DXDY_ARCH: "amd64",
      DXDY_ASSET_DIR: fixture.assets,
      DXDY_ADMIN_DOMAIN: "panel.example.com",
      DXDY_SUBSCRIPTION_DOMAIN: "panel.example.com",
      DXDY_ADMIN_USERNAME: "operator",
      DXDY_ADMIN_PASSWORD_FILE: fixture.password,
      DXDY_CURL_BEHAVIOR: fixture.managerDelivery,
      DXDY_EXISTING_MANAGER: fixture.installedManager,
    },
  });
}

describe("native installer", () => {
  it.each([
    ["debian", "12", "amd64"],
    ["debian", "12", "arm64"],
    ["ubuntu", "22.04", "amd64"],
    ["ubuntu", "22.04", "arm64"],
    ["ubuntu", "24.04", "amd64"],
    ["ubuntu", "24.04", "arm64"],
  ])("prepares %s %s %s without a container runtime", (osId, version, arch) => {
    const root = freshInstall(osId, version, arch, arch === "arm64");
    const config = readFileSync(
      path.join(root, "etc/dx-dy/install.conf"),
      "utf8",
    );
    const env = readFileSync(path.join(root, "etc/dx-dy/dx-dy.env"), "utf8");
    const unit = readFileSync(
      path.join(root, "etc/systemd/system/dx-dy.service"),
      "utf8",
    );
    const caddy = readFileSync(
      path.join(root, "etc/caddy/dx-dy.caddy"),
      "utf8",
    );
    expect(config).toContain("DXDY_VERSION=0.2.6");
    expect(config).toContain("DXDY_RELEASE_MODEL=native-systemd");
    expect(config).toContain(`DXDY_ARCH=${arch}`);
    expect(env).toContain("HOST=127.0.0.1");
    expect(env).toContain("DATABASE_PATH=/var/lib/dx-dy/dx-dy.db");
    expect(lstatSync(path.join(root, "etc/dx-dy/dx-dy.env")).mode & 0o777).toBe(
      0o600,
    );
    expect(unit).toContain("User=dx-dy");
    expect(unit).toContain("/opt/dx-dy/current/runtime/bin/node");
    expect(caddy).toContain("reverse_proxy 127.0.0.1:3000");
    expect(caddy).not.toContain("app:3000");
    expect(readlinkSync(path.join(root, "opt/dx-dy/current"))).toBe(
      "releases/0.2.6",
    );
    expect(
      existsSync(path.join(root, "opt/dx-dy/releases/0.2.6/runtime/bin/node")),
    ).toBe(true);
  });

  it("rejects unsupported hosts", () => {
    const root = temp();
    const osRelease = path.join(root, "os-release");
    writeFileSync(osRelease, 'ID=ubuntu\nVERSION_ID="20.04"\n');
    const result = spawnSync("bash", ["install.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DXDY_TEST_MODE: "1",
        DXDY_ROOT_PREFIX: root,
        DXDY_OS_RELEASE_FILE: osRelease,
      },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unsupported operating system");
  });

  it("contains no GHCR or alternate container-runtime dependency", () => {
    const installer = readFileSync("install.sh", "utf8");
    expect(installer).not.toMatch(/ghcr\.io|podman|nerdctl/);
    expect(installer).not.toContain("install docker");
    expect(installer).toContain("dnsutils libatomic1 caddy");
    expect(installer).not.toContain("dl.cloudsmith.io");
    expect(installer).toContain('cd "$INSTALL_ROOT/current/app"');
  });

  it("adds the Caddy import without accumulating whitespace", () => {
    const original = "unrelated.example.com { respond 200 }\n";
    const root = freshInstall("debian", "12", "amd64", true, original);
    const main = path.join(root, "etc/caddy/Caddyfile");
    expect(readFileSync(main, "utf8")).toBe(
      original + "import /etc/caddy/dx-dy.caddy\n",
    );
  });

  it("separates the Caddy import when the existing file lacks a newline", () => {
    const original = "unrelated.example.com { respond 200 }";
    const root = freshInstall("debian", "12", "amd64", true, original);
    expect(readFileSync(path.join(root, "etc/caddy/Caddyfile"), "utf8")).toBe(
      original + "\nimport /etc/caddy/dx-dy.caddy\n",
    );
  });

  it.each([
    ["isolated single file", false],
    ["process substitution", true],
  ])(
    "installs the verified release manager from %s",
    (_label, processSubstitution) => {
      const fixture = singleFileFixture();
      const result = runSingleFile(fixture, processSubstitution);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(fixture.installedManager, "utf8")).toBe(
        fixture.manager,
      );
      expect(lstatSync(fixture.installedManager).mode & 0o777).toBe(0o755);
    },
  );

  it("rejects a corrupted manager without replacing an existing manager", () => {
    const fixture = singleFileFixture("corrupt");
    const result = runSingleFile(fixture, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Manager checksum failed");
    expect(readFileSync(fixture.installedManager, "utf8")).toContain(
      "existing-manager",
    );
  });

  it("fails safely when the manager download fails", () => {
    const fixture = singleFileFixture("fail");
    const result = runSingleFile(fixture, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Failed to download release asset: dx-dy");
    expect(readFileSync(fixture.installedManager, "utf8")).toContain(
      "existing-manager",
    );
  });

  it("rejects an unusable bundled runtime before committing installation", () => {
    const fixture = singleFileFixture("asset", true);
    const result = runSingleFile(fixture, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Bundled Node runtime cannot start");
    expect(existsSync(fixture.installedManager)).toBe(false);
    expect(existsSync(path.join(fixture.root, "etc/dx-dy"))).toBe(false);
    expect(existsSync(path.join(fixture.root, "opt/dx-dy"))).toBe(false);
  });

  it("reinstalls after normal uninstall while preserving data and credentials", () => {
    const root = freshInstall("debian", "12", "amd64", true);
    const config = path.join(root, "etc/dx-dy");
    const data = path.join(root, "var/lib/dx-dy");
    const database = path.join(data, "dx-dy.db");
    const envFile = path.join(config, "dx-dy.env");
    const masterKey = readFileSync(envFile, "utf8").match(
      /^APP_MASTER_KEY=([a-f0-9]{64})$/m,
    )?.[1];
    expect(masterKey).toBeTruthy();
    writeFileSync(database, "retained database");
    rmSync(path.join(root, "opt/dx-dy"), { recursive: true, force: true });
    rmSync(path.join(root, "usr/local/bin/dx-dy"), { force: true });
    rmSync(path.join(root, "etc/systemd/system/dx-dy.service"), {
      force: true,
    });
    rmSync(path.join(root, "etc/caddy/dx-dy.caddy"), { force: true });

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
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Retained native data detected");
    expect(result.stdout).toContain("Reusing retained domains");
    expect(readFileSync(database, "utf8")).toBe("retained database");
    expect(readFileSync(envFile, "utf8")).toContain(
      `APP_MASTER_KEY=${masterKey}`,
    );
    expect(readlinkSync(path.join(root, "opt/dx-dy/current"))).toBe(
      "releases/0.2.6",
    );
  });

  it("migrates a detected 0.1.8 Compose install after portable and full backups", () => {
    const root = temp();
    const config = path.join(root, "etc/dx-dy");
    const installRoot = path.join(root, "opt/dx-dy");
    const data = path.join(root, "var/lib/dx-dy");
    const backups = path.join(root, "var/backups/dx-dy");
    const bin = path.join(root, "bin");
    const calls = path.join(root, "docker-calls");
    const password = path.join(root, "migration-password");
    mkdirSync(config, { recursive: true });
    mkdirSync(installRoot, { recursive: true });
    mkdirSync(data, { recursive: true });
    mkdirSync(backups, { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      path.join(root, "os-release"),
      'ID=debian\nVERSION_ID="12"\n',
    );
    writeFileSync(
      path.join(installRoot, "docker-compose.yml"),
      "services: {}\n",
    );
    writeFileSync(
      path.join(config, "install.conf"),
      [
        "DXDY_VERSION=0.1.8",
        `DXDY_INSTALL_ROOT=${installRoot}`,
        `DXDY_DATA_DIR=${data}`,
        `DXDY_BACKUP_DIR=${backups}`,
        "DXDY_ADMIN_DOMAIN=panel.example.com",
        "DXDY_SUBSCRIPTION_DOMAIN=sub.example.com",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(config, "runtime.env"),
      `APP_MASTER_KEY=${"1".repeat(64)}\n`,
      { mode: 0o600 },
    );
    writeFileSync(password, "Synthetic-migration-password-123!\n", {
      mode: 0o600,
    });
    executable(
      path.join(bin, "docker"),
      `printf '%s\\n' "$*" >>"${calls}"\nif [[ "$*" == *"ps -q app"* ]]; then printf 'legacy-app\\n'; fi\nif [[ "$*" == *"database.mjs backup"* ]]; then target="\${*: -1}"; printf database >"${backups}/\${target##*/}"; fi\nif [[ "$*" == *"database.mjs bundle"* ]]; then target="\${*: -1}"; printf bundle >"${backups}/\${target##*/}"; fi`,
    );
    const result = spawnSync("bash", ["install.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DXDY_TEST_MODE: "1",
        DXDY_ROOT_PREFIX: root,
        DXDY_OS_RELEASE_FILE: path.join(root, "os-release"),
        DXDY_ARCH: "amd64",
        DXDY_MIGRATION_PASSWORD_FILE: password,
      },
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(config, "install.conf"), "utf8")).toContain(
      "DXDY_RELEASE_MODEL=native-systemd",
    );
    expect(readFileSync(path.join(data, "dx-dy.db"), "utf8")).toBe("database");
    expect(
      readdirSync(backups).some((name) => name.endsWith(".psmbackup")),
    ).toBe(true);
    expect(readFileSync(calls, "utf8")).toContain("stop app caddy");
  });
});

function nativeFixture() {
  const root = temp();
  const config = path.join(root, "etc/dx-dy");
  const install = path.join(root, "opt/dx-dy");
  const data = path.join(root, "var/lib/dx-dy");
  const backups = path.join(root, "var/backups/dx-dy");
  const caddy = path.join(root, "etc/caddy");
  const bin = path.join(root, "bin");
  const calls = path.join(root, "calls");
  const current = path.join(install, "releases/0.1.9");
  mkdirSync(path.join(current, "runtime/bin"), { recursive: true });
  mkdirSync(path.join(current, "app/dist"), { recursive: true });
  mkdirSync(config, { recursive: true });
  mkdirSync(data, { recursive: true });
  mkdirSync(backups, { recursive: true });
  mkdirSync(caddy, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(data, "dx-dy.db"), "database", { mode: 0o600 });
  symlinkSync("releases/0.1.9", path.join(install, "current"));
  writeFileSync(path.join(current, "RELEASE.json"), '{"version":"0.1.9"}\n');
  writeFileSync(
    path.join(current, "Caddyfile.single"),
    "__ADMIN_DOMAIN__ { reverse_proxy 127.0.0.1:__INTERNAL_PORT__ }\n",
  );
  writeFileSync(
    path.join(current, "Caddyfile.dual"),
    "__ADMIN_DOMAIN__ { reverse_proxy 127.0.0.1:__INTERNAL_PORT__ }\n__SUBSCRIPTION_DOMAIN__ { reverse_proxy 127.0.0.1:__INTERNAL_PORT__ }\n",
  );
  executable(
    path.join(current, "runtime/bin/node"),
    `printf 'node cwd=%s args=%s\\n' "$PWD" "$*" >>"${calls}"\nif [[ "$*" == *"database.mjs backup"* ]]; then printf database >"\${*: -1}"; fi\nif [[ "$*" == *"database.mjs bundle"* ]]; then printf bundle >"\${*: -1}"; fi`,
  );
  writeFileSync(
    path.join(config, "install.conf"),
    [
      "DXDY_VERSION=0.1.9",
      "DXDY_RELEASE_MODEL=native-systemd",
      "DXDY_REPOSITORY=torr9522/dx-dy",
      `DXDY_INSTALL_ROOT=${install}`,
      `DXDY_CONFIG_DIR=${config}`,
      `DXDY_DATA_DIR=${data}`,
      `DXDY_BACKUP_DIR=${backups}`,
      "DXDY_INTERNAL_PORT=3000",
      "DXDY_ADMIN_DOMAIN=panel.example.com",
      "DXDY_SUBSCRIPTION_DOMAIN=sub.example.com",
      `DXDY_CADDY_IMPORT=${path.join(caddy, "dx-dy.caddy")}`,
      "DXDY_SERVICE=dx-dy.service",
      `DXDY_SYSTEMD_UNIT_PATH=${path.join(root, "dx-dy.service")}`,
      "DXDY_ARCH=amd64",
      "DXDY_PREVIOUS_RELEASE=",
      "DXDY_LEGACY_ROOT=",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(config, "dx-dy.env"),
    `APP_MASTER_KEY=${"0".repeat(64)}\nDATABASE_PATH=${data}/dx-dy.db\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(caddy, "dx-dy.caddy"),
    "panel.example.com { reverse_proxy 127.0.0.1:3000 }\n",
  );
  writeFileSync(
    path.join(caddy, "Caddyfile"),
    `unrelated.example.com { respond 200 }\nimport ${path.join(caddy, "dx-dy.caddy")}\n`,
  );
  executable(
    path.join(bin, "systemctl"),
    `printf 'systemctl %s\\n' "$*" >>"${calls}"\nif [[ "$1" == is-active ]]; then\n  if [[ "\${DXDY_MOCK_INACTIVE_SERVICE:-}" == "$2" ]]; then printf 'inactive\\n'; exit 3; fi\n  printf 'active\\n'\nfi\nif [[ "\${DXDY_MOCK_START_FAIL:-0}" == 1 && "$*" == "start dx-dy.service" && ! -e "${root}/failed-once" ]]; then touch "${root}/failed-once"; exit 1; fi`,
  );
  executable(path.join(bin, "chown"), `printf 'chown %s\\n' "$*" >>"${calls}"`);
  executable(
    path.join(bin, "curl"),
    `printf '{"name":"dx-dy","status":"ok","version":"0.1.9"}\\n'`,
  );
  executable(
    path.join(bin, "journalctl"),
    `printf 'journalctl %s\\n' "$*" >>"${calls}"`,
  );
  executable(path.join(bin, "caddy"), "exit 0");
  executable(
    path.join(bin, "ss"),
    "printf 'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*\\n'",
  );
  executable(path.join(bin, "getent"), "exit 0");
  writeFileSync(path.join(root, "release.json"), '{"tag_name":"v0.1.9"}\n');
  const managerPath = path.join(root, "dx-dy-manager");
  writeFileSync(managerPath, readFileSync("ops/dx-dy"));
  chmodSync(managerPath, 0o755);
  return {
    root,
    config,
    install,
    data,
    backups,
    caddy,
    bin,
    calls,
    managerPath,
  };
}
function manager(
  f: ReturnType<typeof nativeFixture>,
  args: string[],
  input = "",
  extraEnv: Record<string, string> = {},
) {
  return spawnSync("bash", ["ops/dx-dy", ...args], {
    cwd: process.cwd(),
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      DXDY_CONFIG_DIR: f.config,
      DXDY_ALLOW_TEST_PATHS: "1",
      DXDY_UPDATE_MOCK_DIR: f.root,
      DXDY_MANAGER_PATH: f.managerPath,
      ...extraEnv,
    },
  });
}

function prepareUpdate(f: ReturnType<typeof nativeFixture>) {
  const version = "0.2.6";
  const packageRoot = path.join(f.root, `dx-dy-${version}-linux-amd64`);
  mkdirSync(path.join(packageRoot, "runtime/bin"), { recursive: true });
  mkdirSync(path.join(packageRoot, "app/dist"), { recursive: true });
  executable(
    path.join(packageRoot, "runtime/bin/node"),
    `printf 'updated-node %s\\n' "$*" >>"${f.calls}"`,
  );
  writeFileSync(path.join(packageRoot, "app/dist/server.mjs"), "");
  writeFileSync(path.join(packageRoot, "app/dist/database.mjs"), "");
  writeFileSync(
    path.join(packageRoot, "dx-dy.service"),
    "[Service]\nExecStart=/opt/dx-dy/current/runtime/bin/node /opt/dx-dy/current/app/dist/server.mjs\n",
  );
  writeFileSync(
    path.join(packageRoot, "RELEASE.json"),
    JSON.stringify({ version, release_model: "native-systemd" }),
  );
  const artifact = `dx-dy-${version}-linux-amd64.tar.gz`;
  expect(
    spawnSync("tar", [
      "-czf",
      path.join(f.root, artifact),
      "-C",
      f.root,
      path.basename(packageRoot),
    ]).status,
  ).toBe(0);
  writeFileSync(
    path.join(f.root, "dx-dy"),
    "#!/usr/bin/env bash\necho updated-manager\n",
    { mode: 0o755 },
  );
  const hash = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(
    path.join(f.root, "release.json"),
    JSON.stringify({ tag_name: `v${version}` }),
  );
  writeFileSync(
    path.join(f.root, "release-manifest.json"),
    JSON.stringify({
      version,
      release_model: "native-systemd",
      architectures: ["amd64", "arm64"],
      artifacts: [
        {
          name: artifact,
          architecture: "amd64",
          sha256: hash(path.join(f.root, artifact)),
        },
      ],
      manager_sha256: hash(path.join(f.root, "dx-dy")),
    }),
  );
}

describe("native manager", () => {
  it("uses systemd for lifecycle and journalctl for logs", () => {
    const f = nativeFixture();
    expect(manager(f, ["status"]).stdout).toContain(
      "Release model: native-systemd",
    );
    expect(manager(f, ["start"]).status).toBe(0);
    expect(manager(f, ["stop"]).status).toBe(0);
    expect(manager(f, ["restart"]).status).toBe(0);
    expect(manager(f, ["logs", "app", "25"]).status).toBe(0);
    const calls = readFileSync(f.calls, "utf8");
    expect(calls).toContain("systemctl start dx-dy.service");
    expect(calls).toContain("systemctl stop dx-dy.service");
    expect(calls).toContain("systemctl restart dx-dy.service");
    expect(calls).toContain("journalctl -u dx-dy.service -n 25");
    expect(calls).not.toContain("docker");
  });

  it("renders an inactive service state exactly once", () => {
    const f = nativeFixture();
    const result = manager(f, ["status"], "", {
      DXDY_MOCK_INACTIVE_SERVICE: "dx-dy.service",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Application service: inactive\n");
    expect(result.stdout.match(/inactive/g)).toHaveLength(1);
  });

  it("runs WAL-safe backup through the bundled application CLI", () => {
    const f = nativeFixture();
    const result = manager(f, ["backup", "db"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SHA-256:");
    expect(readdirSync(f.backups).some((name) => name.endsWith(".db"))).toBe(
      true,
    );
    expect(readFileSync(f.calls, "utf8")).toContain("database.mjs backup");
    expect(readFileSync(f.calls, "utf8")).toContain(
      `cwd=${path.join(f.install, "current/app")}`,
    );
  });

  it("restores a full migration bundle through the application CLI", () => {
    const f = nativeFixture();
    const bundle = path.join(f.backups, "fixture.psmbackup");
    writeFileSync(bundle, "synthetic bundle");
    const result = manager(
      f,
      ["restore", bundle],
      "Synthetic-restore-password!\nSynthetic-restore-password!\n",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Restore completed");
    const calls = readFileSync(f.calls, "utf8");
    expect(calls).toContain("database.mjs restore");
    expect(calls).toContain(`chown -R -h dx-dy:dx-dy -- ${f.data}`);
  });

  it("recognizes that 0.1.9 is already current", () => {
    const f = nativeFixture();
    const result = manager(f, ["update"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Already current.");
  });

  it("installs an update through a new release directory and atomic symlink", () => {
    const f = nativeFixture();
    prepareUpdate(f);
    const result = manager(f, ["update"], "", { DXDY_UPDATE_YES: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Updated to dx-dy 0.2.6");
    expect(readlinkSync(path.join(f.install, "current"))).toBe(
      "releases/0.2.6",
    );
    expect(readFileSync(path.join(f.config, "install.conf"), "utf8")).toContain(
      "DXDY_VERSION=0.2.6",
    );
  });

  it("restores the old release link and database after failed update start", () => {
    const f = nativeFixture();
    prepareUpdate(f);
    const result = manager(f, ["update"], "", {
      DXDY_UPDATE_YES: "1",
      DXDY_MOCK_START_FAIL: "1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("ROLLBACK: PASS");
    expect(readlinkSync(path.join(f.install, "current"))).toBe(
      path.join(f.install, "releases/0.1.9"),
    );
    expect(readFileSync(path.join(f.config, "install.conf"), "utf8")).toContain(
      "DXDY_VERSION=0.1.9",
    );
    expect(readFileSync(f.calls, "utf8")).toContain("database.mjs restore");
  });

  it("removes only the dx-dy Caddy import during normal uninstall", () => {
    const f = nativeFixture();
    const result = manager(f, ["uninstall"], "1\n");
    expect(result.status).toBe(0);
    expect(existsSync(f.install)).toBe(false);
    expect(existsSync(f.config)).toBe(true);
    expect(existsSync(f.data)).toBe(true);
    expect(existsSync(f.backups)).toBe(true);
    expect(readFileSync(path.join(f.caddy, "Caddyfile"), "utf8")).toBe(
      "unrelated.example.com { respond 200 }\n",
    );
    expect(existsSync(path.join(f.caddy, "dx-dy.caddy"))).toBe(false);
  });

  it("removes the dx-dy Caddy import during full purge", () => {
    const f = nativeFixture();
    const result = manager(f, ["uninstall"], "2\nDELETE\n");
    expect(result.status).toBe(0);
    expect(existsSync(f.install)).toBe(false);
    expect(existsSync(f.config)).toBe(false);
    expect(existsSync(f.data)).toBe(false);
    expect(existsSync(f.backups)).toBe(false);
    expect(readFileSync(path.join(f.caddy, "Caddyfile"), "utf8")).toBe(
      "unrelated.example.com { respond 200 }\n",
    );
    expect(existsSync(path.join(f.caddy, "dx-dy.caddy"))).toBe(false);
  });
});
