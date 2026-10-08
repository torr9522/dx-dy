import { readFileSync } from "node:fs";
import { Store } from "../apps/api/src/db";
import {
  changeAdminUsername,
  initializeAdmin,
  resetAdminPassword,
} from "../apps/api/src/admin-service";
import { validateDatabase } from "../apps/api/src/database-safety";

const command = process.argv[2];
const database =
  process.env.DATABASE_PATH || "/data/private-subscription-manager.db";

function stdinValue() {
  const value = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  if (!value) throw new Error("A value is required on standard input");
  return value;
}

const store = new Store(database);
try {
  if (command === "init") {
    await store.migrate();
    const [username, ...passwordLines] = readFileSync(0, "utf8")
      .replace(/[\r\n]+$/, "")
      .split(/\r?\n/);
    await initializeAdmin(store, username, passwordLines.join("\n"));
    console.log("Administrator initialized.");
  } else if (command === "reset-password") {
    validateDatabase(store.db);
    await resetAdminPassword(store, stdinValue());
    console.log("Administrator password updated; all sessions invalidated.");
  } else if (command === "change-username") {
    validateDatabase(store.db);
    changeAdminUsername(store, stdinValue());
    console.log("Administrator username updated; all sessions invalidated.");
  } else {
    throw new Error(
      "Usage: admin-cli <init|reset-password|change-username> (value via stdin)",
    );
  }
} finally {
  store.close();
}
