import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitleaks, toolVersion } from "./gitleaks-tool.mjs";
import { forbidden } from "./release-utils.mjs";
export async function secretScan(root = process.cwd(), known = []) {
  const binary = await gitleaks();
  const temp = mkdtempSync(
    path.join(process.env.RELEASE_TMPDIR || os.tmpdir(), "psm-secret-scan-"),
  );
  let findings = 0;
  const scan = (name, args, input) => {
    const report = path.join(temp, name + ".json");
    const result = spawnSync(
      binary,
      [
        ...args,
        "--config",
        path.join(root, ".gitleaks.toml"),
        "--redact=100",
        "--no-banner",
        "--report-format=json",
        "--report-path",
        report,
      ],
      { input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (!existsSync(report))
      throw new Error(
        name + " scanner did not produce a report; gate failed closed",
      );
    const leaks = JSON.parse(readFileSync(report, "utf8"));
    if (!Array.isArray(leaks) || (result.status === 1 && leaks.length === 0))
      throw new Error(name + " unexpected scanner outcome; gate failed closed");
    for (const leak of leaks)
      console.error(
        JSON.stringify({
          scan: name,
          type: leak.RuleID,
          path: leak.File,
          commit: leak.Commit || null,
          line: leak.StartLine,
        }),
      );
    findings += leaks.length;
    if (result.status !== 0 && result.status !== 1)
      throw new Error(name + " secret scanner failed (diagnostics suppressed)");
    console.log(
      `${name}: ${leaks.length ? "FAIL" : "PASS"}; Gitleaks ${toolVersion}; findings=${leaks.length}`,
    );
  };
  try {
    if (existsSync(path.join(root, ".git"))) {
      const files = execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: root, encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean);
      const tree = path.join(temp, "source");
      mkdirSync(tree);
      for (const file of files) {
        if (forbidden(file))
          throw new Error("Forbidden source artifact: " + file);
        const dest = path.join(tree, file);
        mkdirSync(path.dirname(dest), { recursive: true });
        cpSync(path.join(root, file), dest);
      }
      scan("working-tree", ["dir", tree]);
      scan("all-ref-history", ["git", root, "--log-opts=--all --full-history"]);
      // Scan each reachable and unreachable blob independently. Feeding raw
      // `--batch` output as one stream creates false positives across object
      // header boundaries (for example an env assignment plus the next SHA).
      const objectTree = path.join(temp, "git-objects");
      mkdirSync(objectTree);
      const objectLines = execFileSync(
        "git",
        [
          "cat-file",
          "--batch-all-objects",
          "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n");
      for (const line of objectLines) {
        const [oid, type] = line.split(" ");
        if (!["blob", "commit", "tag"].includes(type)) continue;
        const dest = path.join(objectTree, oid);
        const content = execFileSync("git", ["cat-file", type, oid], {
          cwd: root,
        });
        writeFileSync(dest, content);
      }
      scan("all-git-objects-including-tags", ["dir", objectTree]);
      if (known.length) {
        const objects = execFileSync(
          "git",
          ["cat-file", "--batch-all-objects", "--batch"],
          { cwd: root, maxBuffer: 64 * 1024 * 1024 },
        );
        const texts = [
          objects,
          ...files.map((file) => readFileSync(path.join(root, file))),
        ];
        if (
          known.some((secret) =>
            texts.some((text) => text.includes(Buffer.from(secret))),
          )
        )
          throw new Error(
            "Known private value found in source/history/objects; release BLOCKED",
          );
        console.log("Known private values: PASS (values never printed)");
      }
    } else {
      scan("source-archive", ["dir", root]);
      if (known.length)
        throw new Error("Known-value Git audit requires a checkout");
    }
    if (findings)
      throw new Error(
        "SECRET HISTORY/SOURCE CONTAMINATION: review redacted locations; do not rewrite history or publish",
      );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const known = process.argv.includes("--known-secrets-stdin")
    ? JSON.parse(readFileSync(0, "utf8"))
    : [];
  if (
    !Array.isArray(known) ||
    known.some((v) => typeof v !== "string" || v.length < 8)
  )
    throw new Error("Expected JSON array of private values via stdin");
  await secretScan(process.cwd(), known);
}
