import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
export const randomToken = () => randomBytes(32).toString("base64url");
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export function encryptToken(token: string, key: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from("psm:v1:subscription-token"));
  const data = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function decryptToken(ciphertext: string, key: Buffer) {
  const [iv, tag, data] = ciphertext
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const c = createDecipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from("psm:v1:subscription-token"));
  c.setAuthTag(tag);
  return Buffer.concat([c.update(data), c.final()]).toString("utf8");
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
