import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
// flock is kernel-managed: process exit/crash releases it, across Docker PID namespaces.
export async function databaseLock(file: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const child = spawn(
    "flock",
    ["-n", file + ".lock", "sh", "-c", 'printf "LOCKED\\n"; cat >/dev/null'],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("error", () =>
      reject(new Error("Database lock unavailable: install util-linux flock")),
    );
    child.once("exit", () =>
      reject(
        new Error("Database is in use; stop the application before restoring"),
      ),
    );
    child.stdout.once("data", () => resolve());
  });
  let closed = false;
  return () => {
    if (!closed) {
      closed = true;
      child.stdin.end();
    }
  };
}
