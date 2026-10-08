import argon2 from "argon2";
import { z } from "zod";
import { Store, now } from "./db";

export const adminPasswordSchema = z.string().min(12).max(200);
export const adminUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "Username contains unsupported characters");

export const hashAdminPassword = (password: string) =>
  argon2.hash(adminPasswordSchema.parse(password), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

export async function initializeAdmin(
  store: Store,
  username: string,
  password: string,
) {
  const nextUsername = adminUsernameSchema.parse(username);
  const passwordHash = await hashAdminPassword(password);
  store.transaction(() => {
    if (store.get("SELECT id FROM admins WHERE id=1"))
      throw new Error("Administrator account already exists");
    const timestamp = now();
    store.run(
      "INSERT INTO admins VALUES(1,?,?,?,?)",
      nextUsername,
      passwordHash,
      timestamp,
      timestamp,
    );
  });
}

export async function resetAdminPassword(store: Store, password: string) {
  const passwordHash = await hashAdminPassword(password);
  store.transaction(() => {
    if (!store.get("SELECT id FROM admins WHERE id=1"))
      throw new Error("Administrator account does not exist");
    store.run(
      "UPDATE admins SET password_hash=?,updated_at=? WHERE id=1",
      passwordHash,
      now(),
    );
    store.run("DELETE FROM admin_sessions");
  });
}

export function changeAdminUsername(store: Store, username: string) {
  const next = adminUsernameSchema.parse(username);
  store.transaction(() => {
    if (!store.get("SELECT id FROM admins WHERE id=1"))
      throw new Error("Administrator account does not exist");
    store.run(
      "UPDATE admins SET username=?,updated_at=? WHERE id=1",
      next,
      now(),
    );
    store.run("DELETE FROM admin_sessions");
  });
}
