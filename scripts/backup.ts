import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
const file = process.env.DATABASE_PATH || "data/app.sqlite";
const dest =
  process.argv[2] ||
  `data/backups/${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(file);
await backup(db, dest);
db.close();
chmodSync(dest, 0o600);
console.log("SQLite backup completed");
