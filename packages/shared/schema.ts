import { z } from "zod";
export const protocols = [
  "vless",
  "vmess",
  "trojan",
  "ss",
  "hysteria2",
  "tuic",
] as const;
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };
export const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(
      z
        .string()
        .refine((k) => !["__proto__", "constructor", "prototype"].includes(k)),
      jsonValue,
    ),
  ]),
);
export const vmessCredentialError =
  "VMess ID 格式无效：应为 8-4-4-4-12 十六进制 credential";
export const vmessCredentialSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    vmessCredentialError,
  );
export const configSchema = z
  .object({
    type: z.enum(protocols),
    name: z.string().min(1).max(200),
    server: z
      .string()
      .min(1)
      .max(253)
      .refine((s) => !/[\s/?#@]/.test(s), "服务器地址无效"),
    port: z.number().int().min(1).max(65535),
    uuid: z.string().optional(),
    password: z.string().optional(),
    cipher: z.string().optional(),
    tls: z.boolean().optional(),
    network: z.string().optional(),
    sni: z.string().optional(),
    flow: z.string().optional(),
    alpn: z.array(z.string()).optional(),
  })
  .catchall(jsonValue)
  .superRefine((v, c) => {
    if (v.type === "vmess" && !vmessCredentialSchema.safeParse(v.uuid).success)
      c.addIssue({
        code: "custom",
        message: vmessCredentialError,
        path: ["uuid"],
      });
    if (
      ["vless", "tuic"].includes(v.type) &&
      !z.uuid().safeParse(v.uuid).success
    )
      c.addIssue({ code: "custom", message: "UUID 格式无效", path: ["uuid"] });
    if (["trojan", "hysteria2", "tuic"].includes(v.type) && !v.password)
      c.addIssue({ code: "custom", message: "缺少密码", path: ["password"] });
    if (v.type === "ss" && (!v.cipher || (!v.password && v.cipher !== "none")))
      c.addIssue({ code: "custom", message: "缺少 SS 加密或密码" });
    if (
      v["reality-opts"] &&
      !(v["reality-opts"] as Record<string, Json>)["public-key"]
    )
      c.addIssue({ code: "custom", message: "Reality 缺少公钥" });
  });
export type NormalizedNode = z.infer<typeof configSchema>;
export const queryEntrySchema = z.object({
  rawKey: z.string(),
  decodedKey: z.string(),
  rawValue: z.string(),
  decodedValue: z.string(),
  hasEquals: z.boolean(),
  owned: z.boolean(),
});
export const sidecarSchema = z.object({
  query: z.array(queryEntrySchema),
  vmessExtra: z.record(z.string(), jsonValue).default({}),
});
export const envelopeSchema = z.object({
  original_uri: z.string().max(20000),
  normalized_config: configSchema,
  unknown_params: sidecarSchema,
  parser_name: z.literal("Sub-Store"),
  parser_version: z.literal("a3e61061e50b40e5c5938969aab915d05d8d7069"),
  parse_warnings: z.array(z.string()),
  unsupported_fields: z.array(z.string()),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export const nodeEditSchema = z.object({
  normalized_config: configSchema,
  remark: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  enabled: z.boolean().default(true),
  collection_ids: z
    .array(z.number().int().positive())
    .max(100)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
});
export type NodeRecord = Envelope & {
  id: number;
  name: string;
  protocol: string;
  remark: string;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  references: number;
  collection_ids: number[];
  semantic_key?: string;
};
export type NodeCollection = {
  id: number;
  name: string;
  remark: string;
  position: number;
  created_at: string;
  updated_at: string;
  node_count: number;
};
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  remark: z.string().max(2000).default(""),
  enabled: z.boolean().default(true),
});
export type Profile = {
  id: number;
  name: string;
  remark: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  node_ids: number[];
};
