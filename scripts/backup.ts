import { DatabaseSync } from "node:sqlite";
import { snapshot, validateDatabase } from "../apps/api/src/database-safety";
const file =
  process.env.DATABASE_PATH || "/data/private-subscription-manager.db";
const dest =
  process.argv[2] ||
  `data/backups/${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
const db = new DatabaseSync(file);
try {
  validateDatabase(db);
  await snapshot(db, dest, true);
} finally {
  db.close();
}
console.log("Portable SQLite backup completed; sessions excluded");
