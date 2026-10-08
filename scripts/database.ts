import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  chmodSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { Store } from "../apps/api/src/db";
import { databaseLock } from "../apps/api/src/database-lock";
import { decryptToken } from "../apps/api/src/security";
import {
  integrity,
  snapshot,
  validateDatabase,
} from "../apps/api/src/database-safety";
const version = "0.1.8",
  database =
    process.env.DATABASE_PATH || "/data/private-subscription-manager.db";
const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const command = process.argv[2],
  argument = process.argv[3];
const defaultName = (extension: string) =>
  path.resolve("data/backups", `dx-dy-${version}-${stamp()}.${extension}`);
let stdinPassword: string | undefined;
const password = () => {
  if (
    process.env.BACKUP_PASSWORD_STDIN === "true" &&
    stdinPassword === undefined
  )
    stdinPassword = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  const p = stdinPassword ?? process.env.BACKUP_PASSWORD ?? "";
  if (p.length < 16)
    throw new Error("BACKUP_PASSWORD must be at least 16 characters");
  return p;
};
const firstByte = (file: string) => {
  const descriptor = openSync(file, "r"),
    byte = Buffer.alloc(1);
  try {
    return readSync(descriptor, byte, 0, 1, 0) === 1 ? byte.toString() : "";
  } finally {
    closeSync(descriptor);
  }
};
const keyFor = (p: string, salt: Buffer) =>
  scryptSync(p, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
async function portable(target = defaultName("db")) {
  const db = new DatabaseSync(database);
  try {
    validateDatabase(db);
    await snapshot(db, target, true);
  } finally {
    db.close();
  }
  console.log("Portable database backup completed: " + target);
}
async function bundle(target = defaultName("psmbackup")) {
  if (!/^[a-f0-9]{64}$/i.test(process.env.APP_MASTER_KEY || ""))
    throw new Error("APP_MASTER_KEY must be 32-byte hex");
  if (existsSync(target)) throw new Error("Backup destination already exists");
  const temporary = target + ".database.tmp";
  const output = target + `.output-${process.pid}.tmp`;
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const db = new DatabaseSync(database);
    try {
      await snapshot(db, temporary, true);
    } finally {
      db.close();
    }
    const verify = new DatabaseSync(temporary, { readOnly: true });
    let schema: number, instanceId: string;
    try {
      const versions = validateDatabase(verify);
      schema = versions.length;
      instanceId = String(
        JSON.parse(
          String(
            verify
              .prepare("SELECT value FROM settings WHERE key='instance_id'")
              .get()?.value,
          ),
        ),
      );
    } finally {
      verify.close();
    }
    const databaseBytes = readFileSync(temporary),
      manifest = {
        format_version: 1,
        app_version: version,
        schema_version: schema,
        created_at: new Date().toISOString(),
        database_sha256: createHash("sha256")
          .update(databaseBytes)
          .digest("hex"),
        instance_id: instanceId,
        required_migration_minimum: "001_initial.sql",
      };
    const aad = Buffer.from(JSON.stringify(manifest)),
      salt = randomBytes(16),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", keyFor(password(), salt), iv);
    cipher.setAAD(aad);
    const plaintext = Buffer.from(
      JSON.stringify({
        database: databaseBytes.toString("base64"),
        app_master_key: process.env.APP_MASTER_KEY,
      }),
    );
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    writeFileSync(
      output,
      JSON.stringify({
        manifest,
        kdf: {
          name: "scrypt",
          N: 32768,
          r: 8,
          p: 1,
          salt: salt.toString("base64"),
        },
        aead: {
          name: "aes-256-gcm",
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        },
        ciphertext: encrypted.toString("base64"),
      }),
      { mode: 0o600, flag: "wx" },
    );
    renameSync(output, target);
    console.log("Encrypted full migration backup completed: " + target);
  } finally {
    rmSync(temporary, { force: true });
    rmSync(output, { force: true });
  }
}
function decodeBundle(source: string) {
  const outer = JSON.parse(readFileSync(source, "utf8"));
  if (
    outer.manifest?.format_version !== 1 ||
    outer.kdf?.name !== "scrypt" ||
    outer.aead?.name !== "aes-256-gcm"
  )
    throw new Error("Unsupported migration backup format");
  if (
    typeof outer.manifest.app_version !== "string" ||
    !Number.isInteger(outer.manifest.schema_version) ||
    outer.manifest.schema_version < 1 ||
    typeof outer.manifest.created_at !== "string" ||
    typeof outer.manifest.database_sha256 !== "string" ||
    typeof outer.manifest.instance_id !== "string" ||
    !outer.manifest.instance_id ||
    outer.manifest.required_migration_minimum !== "001_initial.sql"
  )
    throw new Error("Invalid migration backup manifest");
  if (outer.kdf.N !== 32768 || outer.kdf.r !== 8 || outer.kdf.p !== 1)
    throw new Error("Unsupported migration backup KDF parameters");
  const aad = Buffer.from(JSON.stringify(outer.manifest)),
    decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(password(), Buffer.from(outer.kdf.salt, "base64")),
      Buffer.from(outer.aead.iv, "base64"),
    );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(outer.aead.tag, "base64"));
  const payload = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(outer.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
  const bytes = Buffer.from(payload.database, "base64");
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    outer.manifest.database_sha256
  )
    throw new Error("Migration backup database checksum mismatch");
  return {
    bytes,
    key: String(payload.app_master_key),
    manifest: outer.manifest,
  };
}
function stageEnvUpdate(file: string, key: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `APP_MASTER_KEY=${key}`;
  const next = /^APP_MASTER_KEY=.*$/m.test(current)
    ? current.replace(/^APP_MASTER_KEY=.*$/m, line)
    : current.replace(/\n?$/, "\n") + line + "\n";
  const temp = file + `.restore-${process.pid}.tmp`;
  writeFileSync(temp, next, { mode: 0o600 });
  chmodSync(temp, 0o600);
  return {
    commit: () => renameSync(temp, file),
    cleanup: () => rmSync(temp, { force: true }),
  };
}
async function restore(source: string) {
  if (!source || !existsSync(source))
    throw new Error("Backup file does not exist");
  const release = await databaseLock(database);
  const directory = path.dirname(database),
    temporary = path.join(directory, ".restore-" + process.pid + ".db");
  let key = process.env.APP_MASTER_KEY || "";
  let bundleSchema: number | null = null;
  let stagedEnv: ReturnType<typeof stageEnvUpdate> | null = null;
  const fullBundle = source.endsWith(".psmbackup") || firstByte(source) === "{";
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fullBundle) {
      const decoded = decodeBundle(source);
      writeFileSync(temporary, decoded.bytes, { mode: 0o600, flag: "wx" });
      key = decoded.key;
      bundleSchema = decoded.manifest.schema_version;
      if (!process.env.INSTANCE_ENV_FILE)
        throw new Error(
          "INSTANCE_ENV_FILE is required for full migration restore",
        );
    } else {
      const input = new DatabaseSync(source, { readOnly: true });
      try {
        validateDatabase(input);
        await snapshot(input, temporary, true);
      } finally {
        input.close();
      }
    }
    if (!/^[a-f0-9]{64}$/i.test(key))
      throw new Error(
        "Matching APP_MASTER_KEY is required for database restore",
      );
    if (fullBundle)
      stagedEnv = stageEnvUpdate(process.env.INSTANCE_ENV_FILE!, key);
    const restored = new DatabaseSync(temporary, { readOnly: true });
    try {
      const versions = validateDatabase(restored);
      if (bundleSchema !== null && versions.length !== bundleSchema)
        throw new Error("Migration backup manifest schema mismatch");
    } finally {
      restored.close();
    }
    const before = existsSync(database)
      ? path.join(directory, "backups/pre-restore-" + Date.now() + ".db")
      : null;
    if (before) {
      const current = new DatabaseSync(database);
      try {
        validateDatabase(current);
        await snapshot(current, before, true);
      } finally {
        current.close();
      }
    }
    const candidate = new Store(temporary);
    try {
      await candidate.migrate();
      candidate.run("DELETE FROM admin_sessions");
      integrity(candidate.db);
      for (const row of candidate.all(
        "SELECT token_ciphertext FROM subscriptions",
      ))
        decryptToken(String(row.token_ciphertext), Buffer.from(key, "hex"));
    } finally {
      candidate.close();
    }
    rmSync(database + "-wal", { force: true });
    rmSync(database + "-shm", { force: true });
    renameSync(temporary, database);
    chmodSync(database, 0o600);
    if (stagedEnv) stagedEnv.commit();
    console.log(
      "Database restore completed; administrator sessions invalidated" +
        (before ? "; pre-restore backup created" : ""),
    );
  } finally {
    rmSync(temporary, { force: true });
    stagedEnv?.cleanup();
    release();
  }
}
if (command === "backup") await portable(argument);
else if (command === "bundle") await bundle(argument);
else if (command === "restore") await restore(argument);
else throw new Error("Usage: database <backup|bundle|restore> [file]");
