import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
export const toolVersion = "8.30.0";
const checksum =
  "79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e";
export async function gitleaks() {
  let binary = process.env.GITLEAKS_BIN;
  if (!binary) {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw new Error("Provide GITLEAKS_BIN version " + toolVersion);
    const dir = path.join(
      os.homedir(),
      ".cache/dx-dy/tools/gitleaks-" + toolVersion,
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    binary = path.join(dir, "gitleaks");
    if (!existsSync(binary)) {
      const temp = mkdtempSync(path.join(dir, "install-"));
      try {
        const res = await fetch(
          `https://github.com/gitleaks/gitleaks/releases/download/v${toolVersion}/gitleaks_${toolVersion}_linux_x64.tar.gz`,
        );
        if (!res.ok) throw new Error("Pinned Gitleaks download failed");
        const data = Buffer.from(await res.arrayBuffer());
        if (createHash("sha256").update(data).digest("hex") !== checksum)
          throw new Error("Gitleaks archive checksum mismatch");
        const archive = path.join(temp, "tool.tar.gz");
        writeFileSync(archive, data, { mode: 0o600 });
        execFileSync("tar", ["-xzf", archive, "-C", temp, "gitleaks"]);
        writeFileSync(binary, readFileSync(path.join(temp, "gitleaks")), {
          mode: 0o700,
        });
        chmodSync(binary, 0o700);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    }
  }
  if (
    execFileSync(binary, ["version"], { encoding: "utf8" }).trim() !==
    toolVersion
  )
    throw new Error("Unexpected Gitleaks version");
  return binary;
}
