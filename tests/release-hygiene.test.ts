import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  releaseRefPolicy,
  validateTagProvenance,
} from "../scripts/ci-ref-check.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temp() {
  const root = mkdtempSync("/tmp/dxdy-release-hygiene-");
  roots.push(root);
  chmodSync(root, 0o755);
  return root;
}

function tree(root: string): string[] {
  const entries: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = statSync(file);
      entries.push(
        `${path.relative(root, file)}:${stat.mode & 0o777}:${stat.size}`,
      );
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(root);
  return entries;
}

function queryInstaller(option: string, nonRoot = false) {
  const root = temp();
  const bin = path.join(root, "bin");
  const script = path.join(root, "install.sh");
  const calls = path.join(root, "calls");
  mkdirSync(bin);
  copyFileSync("install.sh", script);
  chmodSync(script, 0o755);
  for (const command of [
    "apt",
    "apt-get",
    "dpkg",
    "systemctl",
    "useradd",
    "groupadd",
    "docker",
    "caddy",
    "curl",
  ]) {
    const stub = path.join(bin, command);
    writeFileSync(
      stub,
      `#!/bin/sh\nprintf '%s\\n' '${command}' >>'${calls}'\nexit 97\n`,
    );
    chmodSync(stub, 0o755);
  }
  for (const state of ["packages", "users", "services", "caddy", "systemd"])
    writeFileSync(path.join(root, `${state}.state`), "unchanged\n");
  const before = tree(root);
  const identity =
    nonRoot && process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
  const result = spawnSync("bash", [script, option], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      DXDY_ROOT_PREFIX: path.join(root, "filesystem"),
      DXDY_OS_RELEASE_FILE: path.join(root, "missing-os-release"),
    },
    ...identity,
  });
  expect(tree(root)).toEqual(before);
  expect(existsSync(calls)).toBe(false);
  return result;
}

describe("installer query options", () => {
  it.each(["--help", "-h"])(
    "keeps %s side-effect free for non-root users",
    (option) => {
      const result = queryInstaller(option, true);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Usage: install.sh [OPTIONS]");
      expect(result.stdout).toContain("Debian 12");
      expect(result.stdout).toContain("amd64");
    },
  );

  it("reports the version without preflight or mutation", () => {
    const result = queryInstaller("--version", true);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("dx-dy installer 0.2.0\n");
  });

  it("rejects an unknown option before preflight or mutation", () => {
    const result = queryInstaller("--definitely-invalid");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown option: --definitely-invalid");
    expect(result.stderr).toContain("Usage: install.sh [OPTIONS]");
  });
});

describe("release ref policy", () => {
  const version = "0.2.0";

  it("accepts a master branch push", () => {
    expect(
      releaseRefPolicy(
        {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "push",
          GITHUB_REF: "refs/heads/master",
          GITHUB_REF_TYPE: "branch",
          GITHUB_REF_NAME: "master",
        },
        version,
      ),
    ).toEqual({ kind: "branch", branch: "master" });
  });

  it("accepts a pull request targeting master despite detached checkout", () => {
    expect(
      releaseRefPolicy(
        {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_REF: "refs/pull/42/merge",
          GITHUB_REF_TYPE: "branch",
          GITHUB_REF_NAME: "42/merge",
          GITHUB_BASE_REF: "master",
        },
        version,
      ).kind,
    ).toBe("pull-request");
  });

  it("accepts a direct release tag and matching master provenance", () => {
    const policy = releaseRefPolicy(
      {
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/tags/v0.2.0",
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v0.2.0",
      },
      version,
    );
    expect(policy).toEqual({ kind: "tag", tag: "v0.2.0" });
    expect(() =>
      validateTagProvenance({
        head: "abc",
        tagTarget: "abc",
        remoteMaster: "abc",
      }),
    ).not.toThrow();
  });

  it.each(["v0.2.0-rc.1", "release-0.2.0", "v0.2"])(
    "rejects invalid release tag %s",
    (tag) => {
      expect(() =>
        releaseRefPolicy(
          {
            GITHUB_ACTIONS: "true",
            GITHUB_EVENT_NAME: "push",
            GITHUB_REF: `refs/tags/${tag}`,
            GITHUB_REF_TYPE: "tag",
            GITHUB_REF_NAME: tag,
          },
          version,
        ),
      ).toThrow();
    },
  );

  it("rejects a tag target that is not current origin/master", () => {
    expect(() =>
      validateTagProvenance({
        head: "topic",
        tagTarget: "topic",
        remoteMaster: "main",
      }),
    ).toThrow("must equal origin/master");
  });

  it("classifies an ordinary local detached checkout as local, not a tag", () => {
    expect(releaseRefPolicy({}, version)).toEqual({ kind: "local" });
  });
});
