import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { z, ZodError } from "zod";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Store, now } from "./db";
import {
  adminPasswordSchema,
  hashAdminPassword,
  resetAdminPassword,
} from "./admin-service";
import { normalizeHttpsOrigin, setSubscriptionBase } from "./domain-service";
import {
  decryptToken,
  digest,
  encryptToken,
  equal,
  randomToken,
} from "./security";
import {
  nodeEditSchema,
  profileSchema,
  type Envelope,
} from "../../../packages/shared/schema";
import {
  editConfig,
  generateURI,
  generateUniversalUriLines,
  generateUniversalBase64Subscription,
  dedupeSubscriptionNodes,
  findSemanticDuplicateGroups,
  getNodeSemanticKey,
  parseNode,
  preview,
} from "../../../packages/proxy-adapter";
export type Options = {
  database: string;
  masterKey: string;
  initialPassword: string;
  username?: string;
  secure?: boolean;
  adminBase: string;
  subscriptionBase: string;
  trustProxy?: number;
  loginLimit?: number;
  subscriptionLimit?: number;
  webDir?: string;
};
export function normalizeSubscriptionBase(
  input: string,
  allowInsecureLocalhost = false,
) {
  try {
    return normalizeHttpsOrigin(input, allowInsecureLocalhost);
  } catch {
    throw new ApiError(400, "SUBSCRIPTION_BASE_URL", "订阅域名格式不正确");
  }
}
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
function id(req: Request) {
  return z.coerce.number().int().positive().parse(req.params.id);
}
export async function createApp(options: Options) {
  if (!/^[a-f0-9]{64}$/i.test(options.masterKey))
    throw new Error("APP_MASTER_KEY must be 32-byte hex");
  const key = Buffer.from(options.masterKey, "hex");
  const store = new Store(options.database);
  await store.migrate();
  if (!store.settings().instance_id) store.set("instance_id", randomUUID());
  const persistedSubscriptionBase = store.settings().subscription_base_url;
  const normalizedSubscriptionBase = normalizeSubscriptionBase(
    persistedSubscriptionBase
      ? String(persistedSubscriptionBase)
      : options.subscriptionBase,
    !options.secure,
  );
  if (persistedSubscriptionBase !== normalizedSubscriptionBase)
    store.set("subscription_base_url", normalizedSubscriptionBase);
  if (!store.get("SELECT id FROM admins")) {
    if (options.initialPassword.length < 20)
      throw new Error("Initial password must be at least 20 characters");
    store.run(
      "INSERT INTO admins VALUES(1,?,?,?,?)",
      options.username || "admin",
      await hashAdminPassword(options.initialPassword),
      now(),
      now(),
    );
  }
  const dummy = await argon2.hash(randomToken(), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy || false);
  app.use(
    helmet({
      referrerPolicy: { policy: "no-referrer" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: options.secure ? [] : null,
        },
      },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  const adminHost = new URL(options.adminBase).host.toLowerCase();
  const subscriptionBase = () => String(store.settings().subscription_base_url);
  const buildSubscriptionUrl = (token: string) =>
    `${subscriptionBase()}/s/${token}`;
  app.use((req, res, next) => {
    const host = String(req.headers.host || "").toLowerCase();
    const loopbackHealth =
      req.path === "/health" &&
      /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    if (loopbackHealth) return next();
    const subscriptionHost = new URL(subscriptionBase()).host.toLowerCase();
    const sameDomain = adminHost === subscriptionHost;
    const storedLegacyHosts = store.settings().subscription_legacy_hosts;
    const legacyHosts = Array.isArray(storedLegacyHosts)
      ? storedLegacyHosts.map(String).map((value) => value.toLowerCase())
      : [];
    const subscriptionOnlyHost =
      host === subscriptionHost || legacyHosts.includes(host);
    if (
      !sameDomain &&
      subscriptionOnlyHost &&
      host !== adminHost &&
      req.path !== "/health" &&
      !req.path.startsWith("/s/")
    )
      return res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "接口不存在" } });
    if (!sameDomain && host !== adminHost && !subscriptionOnlyHost)
      return res
        .status(421)
        .json({ error: { code: "HOST", message: "主机不允许" } });
    next();
  });
  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: { code: "RATE_LIMIT", message: "请求过于频繁，请稍后重试" },
      },
    });
  const cookie = {
    httpOnly: true,
    secure: !!options.secure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  };
  const fail = (status: number, code: string, message: string) => {
    throw new ApiError(status, code, message);
  };
  const parseURI = (text: string) => {
    try {
      return parseNode(text);
    } catch {
      return fail(400, "PARSE", "节点链接解析失败，请检查格式与参数");
    }
  };
  app.get("/health", (_req, res) => {
    store.get("SELECT 1");
    res.json({ name: "dx-dy", status: "ok", database: "ok", version: "0.2.5" });
  });
  app.post(
    "/api/auth/login",
    limiter(options.loginLimit ?? 15),
    async (req, res) => {
      if (req.headers.origin && req.headers.origin !== options.adminBase)
        return fail(403, "ORIGIN", "来源不允许");
      const input = z
        .object({
          username: z.string().max(100),
          password: z.string().max(1000),
        })
        .parse(req.body);
      const a = store.get(
        "SELECT * FROM admins WHERE username=?",
        input.username,
      );
      const valid = await argon2.verify(
        String(a?.password_hash || dummy),
        input.password,
      );
      if (!a || !valid) return fail(401, "LOGIN", "用户名或密码错误");
      store.run("DELETE FROM admin_sessions WHERE expires_at<?", now());
      if (req.cookies.psm_session)
        store.run(
          "DELETE FROM admin_sessions WHERE session_hash=?",
          digest(req.cookies.psm_session),
        );
      const session = randomToken(),
        csrf = randomToken();
      const t = now();
      store.run(
        "INSERT INTO admin_sessions VALUES(?,1,?,?,?,?)",
        digest(session),
        csrf,
        new Date(Date.now() + cookie.maxAge).toISOString(),
        t,
        t,
      );
      res
        .cookie("psm_session", session, cookie)
        .json({ username: String(a.username), csrf });
    },
  );
  app.use("/api", (req, res, next) => {
    const raw = req.cookies.psm_session;
    if (typeof raw !== "string")
      return next(new ApiError(401, "UNAUTHORIZED", "请先登录"));
    const session = store.get(
      "SELECT * FROM admin_sessions WHERE session_hash=? AND expires_at>?",
      digest(raw),
      now(),
    );
    if (!session) return next(new ApiError(401, "UNAUTHORIZED", "会话已过期"));
    res.locals.session = session;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        !equal(
          String(req.headers["x-csrf-token"] || ""),
          String(session.csrf_token),
        )
      )
        return next(new ApiError(403, "CSRF", "安全校验失败，请刷新登录状态"));
      if (req.headers.origin && req.headers.origin !== options.adminBase)
        return next(new ApiError(403, "ORIGIN", "来源不允许"));
    }
    store.run(
      "UPDATE admin_sessions SET last_seen_at=? WHERE session_hash=?",
      now(),
      String(session.session_hash),
    );
    next();
  });
  app.get("/api/auth/me", (_req, res) =>
    res.json({
      username: store.get("SELECT username FROM admins WHERE id=1")?.username,
      csrf: res.locals.session.csrf_token,
    }),
  );
  app.post("/api/auth/logout", (_req, res) => {
    store.run(
      "DELETE FROM admin_sessions WHERE session_hash=?",
      String(res.locals.session.session_hash),
    );
    res.clearCookie("psm_session", cookie).json({ ok: true });
  });
  app.post("/api/auth/password", limiter(10), async (req, res) => {
    const x = z
      .object({ current: z.string(), password: adminPasswordSchema })
      .parse(req.body);
    const admin = store.get("SELECT * FROM admins WHERE id=1");
    if (!(await argon2.verify(String(admin?.password_hash), x.current)))
      return fail(400, "PASSWORD", "当前密码错误");
    await resetAdminPassword(store, x.password);
    res.clearCookie("psm_session", cookie).json({ ok: true });
  });
  app.get("/api/nodes", (_req, res) =>
    res.json(
      store.nodes().map((node) => ({
        ...node,
        semantic_key: getNodeSemanticKey(node),
      })),
    ),
  );
  const collectionSchema = z.object({
    name: z.string().trim().min(1).max(100),
    remark: z.string().max(2000).default(""),
  });
  const requireCollections = (ids: number[]) => {
    if (
      ids.some(
        (collectionId) =>
          !store.get(
            "SELECT id FROM node_collections WHERE id=?",
            collectionId,
          ),
      )
    )
      fail(400, "COLLECTION", "含不存在的节点集合");
  };
  app.get("/api/collections", (_req, res) => res.json(store.collections()));
  app.post("/api/collections", (req, res) => {
    const x = collectionSchema.parse(req.body),
      t = now();
    if (store.get("SELECT id FROM node_collections WHERE name=?", x.name))
      return fail(409, "COLLECTION_NAME", "集合名称已存在");
    const position = Number(
      store.get("SELECT COALESCE(MAX(position),-1)+1 p FROM node_collections")
        ?.p,
    );
    const r = store.run(
      "INSERT INTO node_collections(name,remark,position,created_at,updated_at) VALUES(?,?,?,?,?)",
      x.name,
      x.remark,
      position,
      t,
      t,
    );
    res
      .status(201)
      .json(
        store.collections().find((c) => c.id === Number(r.lastInsertRowid)),
      );
  });
  app.patch("/api/collections/:id", (req, res) => {
    const collectionId = id(req),
      x = collectionSchema.parse(req.body);
    if (!store.get("SELECT id FROM node_collections WHERE id=?", collectionId))
      return fail(404, "NOT_FOUND", "集合不存在");
    if (
      store.get(
        "SELECT id FROM node_collections WHERE name=? AND id<>?",
        x.name,
        collectionId,
      )
    )
      return fail(409, "COLLECTION_NAME", "集合名称已存在");
    store.run(
      "UPDATE node_collections SET name=?,remark=?,updated_at=? WHERE id=?",
      x.name,
      x.remark,
      now(),
      collectionId,
    );
    res.json(store.collections().find((c) => c.id === collectionId));
  });
  app.put("/api/collections/order", (req, res) => {
    const ids = z
        .object({
          ids: z
            .array(z.number().int().positive())
            .max(200)
            .refine((v) => new Set(v).size === v.length),
        })
        .parse(req.body).ids,
      existing = store.collections().map((c) => c.id);
    if (
      ids.length !== existing.length ||
      ids.some((i) => !existing.includes(i))
    )
      return fail(400, "ORDER", "集合顺序必须包含全部集合");
    store.transaction(() =>
      ids.forEach((collectionId, position) =>
        store.run(
          "UPDATE node_collections SET position=?,updated_at=? WHERE id=?",
          position,
          now(),
          collectionId,
        ),
      ),
    );
    res.json(store.collections());
  });
  app.delete("/api/collections/:id", (req, res) => {
    const collectionId = id(req);
    if (!store.get("SELECT id FROM node_collections WHERE id=?", collectionId))
      return fail(404, "NOT_FOUND", "集合不存在");
    store.run("DELETE FROM node_collections WHERE id=?", collectionId);
    res.json({ ok: true });
  });
  const membershipSchema = z.object({
    node_ids: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .refine((values) => new Set(values).size === values.length),
  });
  const requireCollectionAndNodes = (
    collectionId: number,
    nodeIds: number[],
  ) => {
    if (!store.get("SELECT id FROM node_collections WHERE id=?", collectionId))
      return fail(404, "NOT_FOUND", "节点集合不存在");
    const placeholders = nodeIds.map(() => "?").join(",");
    const count = Number(
      store.get(
        `SELECT COUNT(*) AS count FROM nodes WHERE id IN (${placeholders})`,
        ...nodeIds,
      )?.count,
    );
    if (count !== nodeIds.length)
      return fail(400, "NODE_IDS", "包含不存在的节点");
  };
  app.post("/api/collections/:id/nodes", (req, res) => {
    const collectionId = id(req),
      { node_ids } = membershipSchema.parse(req.body);
    requireCollectionAndNodes(collectionId, node_ids);
    store.transaction(() =>
      store.addCollectionMembers([collectionId], node_ids),
    );
    res.json({ collection_id: collectionId, node_ids });
  });
  app.delete("/api/collections/:id/nodes", (req, res) => {
    const collectionId = id(req),
      { node_ids } = membershipSchema.parse(req.body);
    requireCollectionAndNodes(collectionId, node_ids);
    store.transaction(() =>
      store.removeCollectionMembers([collectionId], node_ids),
    );
    res.json({ collection_id: collectionId, node_ids });
  });
  app.put("/api/collection-memberships", (req, res) => {
    const { action, collection_ids, node_ids } = z
      .object({
        action: z.enum(["add", "remove", "set"]),
        collection_ids: z
          .array(z.number().int().positive())
          .max(100)
          .refine((values) => new Set(values).size === values.length),
        node_ids: membershipSchema.shape.node_ids,
      })
      .parse(req.body);
    requireCollections(collection_ids);
    const placeholders = node_ids.map(() => "?").join(",");
    const count = Number(
      store.get(
        `SELECT COUNT(*) AS count FROM nodes WHERE id IN (${placeholders})`,
        ...node_ids,
      )?.count,
    );
    if (count !== node_ids.length)
      return fail(400, "NODE_IDS", "包含不存在的节点");
    store.transaction(() => {
      if (action === "add")
        store.addCollectionMembers(collection_ids, node_ids);
      else if (action === "remove")
        store.removeCollectionMembers(collection_ids, node_ids);
      else store.replaceCollectionMembers(collection_ids, node_ids);
    });
    res.json({ action, collection_ids, node_ids });
  });
  app.post("/api/nodes/preview", (req, res) => {
    const { text } = z
      .object({ text: z.string().min(1).max(200000) })
      .parse(req.body);
    if (text.split("\n").length > 300)
      return fail(400, "LIMIT", "每批最多 300 行");
    res.json(preview(text, store.nodes()));
  });
  app.post("/api/nodes/import", (req, res) => {
    const { items, collection_ids } = z
      .object({
        collection_ids: z
          .array(z.number().int().positive())
          .max(100)
          .default([]),
        items: z
          .array(
            z.object({
              uri: z.string().max(20000),
              name: z.string().min(1).max(200).optional(),
            }),
          )
          .min(1)
          .max(300),
      })
      .parse(req.body);
    requireCollections(collection_ids);
    const parsed = items.map((x) => {
      const e = parseURI(x.uri);
      if (x.name) e.normalized_config.name = x.name;
      return e;
    });
    const ids = store.transaction(() =>
      parsed.map((e) => {
        const nodeId = store.addNode(e);
        store.setCollections(nodeId, collection_ids);
        return nodeId;
      }),
    );
    res.status(201).json(ids.map((n) => store.findNode(n)));
  });
  const getNode = (req: Request) =>
    store.findNode(id(req)) || fail(404, "NOT_FOUND", "节点不存在");
  app.get("/api/nodes/:id/uri", (req, res) =>
    res.json({ uri: generateURI(getNode(req)) }),
  );
  app.patch("/api/nodes/:id", (req, res) => {
    const n = getNode(req);
    const x = nodeEditSchema.parse(req.body);
    if (x.collection_ids) requireCollections(x.collection_ids);
    const e = editConfig(n, x.normalized_config);
    generateURI(e);
    store.transaction(() => {
      store.updateNode(n.id, e, x.remark, x.tags, x.enabled);
      if (x.collection_ids) store.setCollections(n.id, x.collection_ids);
    });
    res.json(store.findNode(n.id));
  });
  app.post("/api/nodes/:id/reimport-preview", (req, res) => {
    const n = getNode(req),
      x = z.object({ uri: z.string().max(20000) }).parse(req.body);
    const e = parseURI(x.uri);
    res.json({
      envelope: e,
      diff: Object.keys({ ...n.normalized_config, ...e.normalized_config })
        .filter(
          (k) =>
            JSON.stringify(n.normalized_config[k]) !==
            JSON.stringify(e.normalized_config[k]),
        )
        .map((field) => ({
          field,
          old: n.normalized_config[field],
          new: e.normalized_config[field],
        })),
    });
  });
  app.post("/api/nodes/:id/reimport", (req, res) => {
    const n = getNode(req),
      x = z
        .object({ uri: z.string().max(20000), confirm: z.literal(true) })
        .parse(req.body);
    const e = parseURI(x.uri);
    store.updateNode(n.id, e, n.remark, n.tags, n.enabled);
    res.json(store.findNode(n.id));
  });
  app.post("/api/nodes/:id/restore", (req, res) => {
    const n = getNode(req);
    z.object({ confirm: z.literal(true) }).parse(req.body);
    store.updateNode(
      n.id,
      parseURI(n.original_uri),
      n.remark,
      n.tags,
      n.enabled,
    );
    res.json(store.findNode(n.id));
  });
  app.delete("/api/nodes/:id", (req, res) => {
    const n = getNode(req);
    if (n.references)
      return fail(
        409,
        "REFERENCED",
        `该节点正在被 ${n.references} 个订阅使用，请先从订阅中移除`,
      );
    z.object({ confirm: z.literal(true) }).parse(req.body);
    store.run("DELETE FROM nodes WHERE id=?", n.id);
    res.json({ ok: true });
  });
  app.post("/api/nodes/batch-delete", (req, res) => {
    const { node_ids } = z
      .object({
        node_ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(1000)
          .refine((values) => new Set(values).size === values.length),
        confirm: z.literal(true),
      })
      .parse(req.body);
    const byId = new Map(store.nodes().map((node) => [node.id, node]));
    if (node_ids.some((nodeId) => !byId.has(nodeId)))
      return fail(400, "NODE", "含不存在的节点");
    const referenced = node_ids
      .map((nodeId) => byId.get(nodeId)!)
      .filter((node) => node.references > 0);
    if (referenced.length)
      throw new ApiError(
        409,
        "REFERENCED_NODES",
        `${referenced.length} 个节点仍被订阅使用，请先从订阅中移除`,
        {
          referenced_count: referenced.length,
          nodes: referenced.map((node) => ({
            id: node.id,
            name: node.name,
            references: node.references,
          })),
        },
      );
    store.transaction(() => {
      for (const nodeId of node_ids)
        store.run("DELETE FROM nodes WHERE id=?", nodeId);
    });
    res.json({ ok: true, deleted: node_ids.length });
  });
  app.patch("/api/nodes/:id/enabled", (req, res) => {
    const n = getNode(req);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    store.setNodeEnabled(n.id, enabled);
    res.json(store.findNode(n.id));
  });
  const getProfile = (req: Request) =>
    store.get("SELECT * FROM subscriptions WHERE id=?", id(req)) ||
    fail(404, "NOT_FOUND", "订阅不存在");
  const localNodeId = (req: Request) =>
    z.coerce.number().int().positive().parse(req.params.localNodeId);
  const getLocalNode = (req: Request) => {
    getProfile(req);
    return (
      store.findLocalNode(id(req), localNodeId(req)) ||
      fail(404, "NOT_FOUND", "独立节点不存在")
    );
  };
  const rejectSemanticDuplicates = (
    nodes: (Envelope & { id?: number; name?: string; protocol?: string })[],
  ) => {
    const duplicateGroups = findSemanticDuplicateGroups(nodes);
    if (!duplicateGroups.length) return;
    throw new ApiError(
      422,
      "DUPLICATE_SEMANTICS",
      "存在重复连接配置，请取消重复节点后再保存",
      {
        duplicates: duplicateGroups.flatMap(({ nodes: group }) =>
          group.slice(1).map((node) => ({
            node_id: node.id,
            display_name: node.normalized_config.name,
            protocol: node.normalized_config.type,
            duplicate_of_node_id: group[0].id,
            duplicate_of: group[0].normalized_config.name,
          })),
        ),
      },
    );
  };
  const tokenData = () => {
    const token = randomToken();
    return { hash: digest(token), cipher: encryptToken(token, key) };
  };
  app.get("/api/subscriptions", (_req, res) => res.json(store.profiles()));
  app.post("/api/subscriptions", (req, res) => {
    const x = profileSchema.parse(req.body),
      t = tokenData();
    const inserted = store.run(
      "INSERT INTO subscriptions(name,remark,token_hash,token_ciphertext,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      x.name,
      x.remark,
      t.hash,
      t.cipher,
      Number(x.enabled),
      now(),
      now(),
    );
    res
      .status(201)
      .json(
        store.profile(
          store.get(
            "SELECT * FROM subscriptions WHERE id=?",
            Number(inserted.lastInsertRowid),
          )!,
        ),
      );
  });
  app.patch("/api/subscriptions/:id", (req, res) => {
    getProfile(req);
    const x = profileSchema.parse(req.body);
    store.run(
      "UPDATE subscriptions SET name=?,remark=?,enabled=?,updated_at=? WHERE id=?",
      x.name,
      x.remark,
      Number(x.enabled),
      now(),
      id(req),
    );
    res.json(store.profile(getProfile(req)));
  });
  app.delete("/api/subscriptions/:id", (req, res) => {
    getProfile(req);
    store.run("DELETE FROM subscriptions WHERE id=?", id(req));
    res.json({ ok: true });
  });
  app.get("/api/subscriptions/:id/entries", (req, res) => {
    getProfile(req);
    res.json(
      store.subscriptionEntries(id(req)).map((entry) => ({
        ...entry,
        node: {
          ...entry.node,
          semantic_key: getNodeSemanticKey(entry.node),
        },
      })),
    );
  });
  app.put("/api/subscriptions/:id/nodes", (req, res) => {
    getProfile(req);
    const { node_ids } = z
      .object({
        node_ids: z
          .array(z.number().int().positive())
          .max(1000)
          .refine((a) => new Set(a).size === a.length),
      })
      .parse(req.body);
    const byId = new Map(store.nodes().map((node) => [node.id, node]));
    if (node_ids.some((nodeId) => !byId.has(nodeId)))
      return fail(400, "NODE", "含不存在的节点");
    const selected = node_ids.map((nodeId) => byId.get(nodeId)!);
    const locals = store
      .subscriptionEntries(id(req))
      .filter((entry) => entry.source === "local")
      .map((entry) => entry.node);
    rejectSemanticDuplicates([...selected, ...locals]);
    store.assign(id(req), node_ids);
    res.json(store.profile(getProfile(req)));
  });
  app.put("/api/subscriptions/:id/entries/order", (req, res) => {
    getProfile(req);
    const { entry_ids } = z
      .object({
        entry_ids: z
          .array(z.number().int().positive())
          .max(1300)
          .refine((values) => new Set(values).size === values.length),
      })
      .parse(req.body);
    const existing = store
      .subscriptionEntries(id(req))
      .map((entry) => entry.id);
    if (
      entry_ids.length !== existing.length ||
      entry_ids.some((entryId) => !existing.includes(entryId))
    )
      return fail(400, "ENTRY_ORDER", "节点顺序必须包含当前订阅的全部节点");
    rejectSemanticDuplicates(
      store.subscriptionEntries(id(req)).map((entry) => entry.node),
    );
    store.reorderEntries(id(req), entry_ids);
    res.json(store.subscriptionEntries(id(req)));
  });
  app.delete("/api/subscriptions/:id/entries/:entryId", (req, res) => {
    getProfile(req);
    const entryId = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.params.entryId);
    if (
      !store.subscriptionEntries(id(req)).some((entry) => entry.id === entryId)
    )
      return fail(404, "NOT_FOUND", "订阅节点不存在");
    store.deleteEntry(id(req), entryId);
    res.json({ ok: true });
  });
  app.post("/api/subscriptions/:id/local-nodes/preview", (req, res) => {
    getProfile(req);
    const { text } = z
      .object({ text: z.string().min(1).max(200000) })
      .parse(req.body);
    if (text.split("\n").length > 300)
      return fail(400, "LIMIT", "每批最多 300 行");
    res.json(
      preview(
        text,
        store.subscriptionEntries(id(req)).map((entry) => entry.node),
      ),
    );
  });
  app.post("/api/subscriptions/:id/local-nodes/import", (req, res) => {
    getProfile(req);
    const { items } = z
      .object({
        items: z
          .array(
            z.object({
              uri: z.string().max(20000),
              name: z.string().min(1).max(200).optional(),
            }),
          )
          .min(1)
          .max(300),
      })
      .parse(req.body);
    const parsed = items.map((item) => {
      const envelope = parseURI(item.uri);
      if (item.name) envelope.normalized_config.name = item.name;
      return envelope;
    });
    rejectSemanticDuplicates([
      ...store.subscriptionEntries(id(req)).map((entry) => entry.node),
      ...parsed,
    ]);
    const created = parsed.map((envelope) =>
      store.addLocalNode(id(req), envelope),
    );
    res.status(201).json(
      created.map(({ entryId, localNodeId }) => ({
        entry_id: entryId,
        node: store.findLocalNode(id(req), localNodeId),
      })),
    );
  });
  app.get("/api/subscriptions/:id/local-nodes/:localNodeId/uri", (req, res) =>
    res.json({ uri: generateURI(getLocalNode(req)) }),
  );
  app.patch("/api/subscriptions/:id/local-nodes/:localNodeId", (req, res) => {
    const node = getLocalNode(req);
    const input = nodeEditSchema.parse(req.body);
    const envelope = editConfig(node, input.normalized_config);
    generateURI(envelope);
    const others = store
      .subscriptionEntries(id(req))
      .filter(
        (entry) =>
          !(entry.source === "local" && entry.node.id === localNodeId(req)),
      )
      .map((entry) => entry.node);
    rejectSemanticDuplicates([...others, envelope]);
    store.updateLocalNode(
      id(req),
      localNodeId(req),
      envelope,
      input.remark,
      input.enabled,
    );
    res.json(store.findLocalNode(id(req), localNodeId(req)));
  });
  app.post(
    "/api/subscriptions/:id/local-nodes/:localNodeId/reimport-preview",
    (req, res) => {
      const node = getLocalNode(req);
      const input = z.object({ uri: z.string().max(20000) }).parse(req.body);
      const envelope = parseURI(input.uri);
      res.json({
        envelope,
        diff: Object.keys({
          ...node.normalized_config,
          ...envelope.normalized_config,
        })
          .filter(
            (field) =>
              JSON.stringify(node.normalized_config[field]) !==
              JSON.stringify(envelope.normalized_config[field]),
          )
          .map((field) => ({
            field,
            old: node.normalized_config[field],
            new: envelope.normalized_config[field],
          })),
      });
    },
  );
  app.post(
    "/api/subscriptions/:id/local-nodes/:localNodeId/reimport",
    (req, res) => {
      const node = getLocalNode(req);
      const input = z
        .object({ uri: z.string().max(20000), confirm: z.literal(true) })
        .parse(req.body);
      const envelope = parseURI(input.uri);
      const others = store
        .subscriptionEntries(id(req))
        .filter(
          (entry) =>
            !(entry.source === "local" && entry.node.id === localNodeId(req)),
        )
        .map((entry) => entry.node);
      rejectSemanticDuplicates([...others, envelope]);
      store.updateLocalNode(
        id(req),
        localNodeId(req),
        envelope,
        node.remark,
        node.enabled,
      );
      res.json(store.findLocalNode(id(req), localNodeId(req)));
    },
  );
  app.post(
    "/api/subscriptions/:id/local-nodes/:localNodeId/restore",
    (req, res) => {
      const node = getLocalNode(req);
      z.object({ confirm: z.literal(true) }).parse(req.body);
      const envelope = parseURI(node.original_uri);
      const others = store
        .subscriptionEntries(id(req))
        .filter(
          (entry) =>
            !(entry.source === "local" && entry.node.id === localNodeId(req)),
        )
        .map((entry) => entry.node);
      rejectSemanticDuplicates([...others, envelope]);
      store.updateLocalNode(
        id(req),
        localNodeId(req),
        envelope,
        node.remark,
        node.enabled,
      );
      res.json(store.findLocalNode(id(req), localNodeId(req)));
    },
  );
  app.post("/api/subscriptions/:id/rotate", (req, res) => {
    getProfile(req);
    const t = tokenData();
    store.run(
      "UPDATE subscriptions SET token_hash=?,token_ciphertext=?,updated_at=? WHERE id=?",
      t.hash,
      t.cipher,
      now(),
      id(req),
    );
    res.json({ ok: true });
  });
  app.get("/api/subscriptions/:id/url", (req, res) => {
    const p = getProfile(req);
    const token = decryptToken(String(p.token_ciphertext), key);
    res.json({ url: buildSubscriptionUrl(token) });
  });
  const render = <T extends Envelope & { id?: number }>(
    nodes: T[],
    format: string,
  ) => {
    const { emitted, suppressed } = dedupeSubscriptionNodes(nodes);
    return {
      body:
        format === "raw"
          ? generateUniversalUriLines(emitted)
          : generateUniversalBase64Subscription(emitted),
      contentType: "text/plain; charset=utf-8",
      mode: format === "raw" ? "raw" : "universal-base64",
      emitted,
      suppressed,
    };
  };
  app.get("/api/subscriptions/:id/preview", (req, res) => {
    const p = getProfile(req);
    const f = z
      .enum(["auto", "raw", "v2ray", "shadowrocket"])
      .parse(req.query.format || "auto");
    const selectedNodes = store.selectedNodes(Number(p.id));
    const nodes = selectedNodes.filter((node) => node.enabled);
    const output = render(nodes, f);
    const duplicateGroups = findSemanticDuplicateGroups(selectedNodes);
    res.json({
      body: output.body,
      contentType: output.contentType,
      mode: output.mode,
      decoded: generateUniversalUriLines(output.emitted),
      selected_node_count: selectedNodes.length,
      emitted_node_count: output.emitted.length,
      suppressed_duplicate_count: output.suppressed.length,
      duplicate_groups: duplicateGroups.map(({ nodes: group }) =>
        group.map((node) => ({
          node_id: node.id,
          name: node.name,
          protocol: node.protocol,
        })),
      ),
      nodes: output.emitted.map((node) => ({
        name: node.normalized_config.name,
        protocol: node.normalized_config.type,
      })),
    });
  });
  app.get("/api/dashboard", (_req, res) => {
    const nodes = store.nodes(),
      subs = store.profiles();
    res.json({
      nodes: nodes.length,
      enabled_nodes: nodes.filter((n) => n.enabled).length,
      subscriptions: subs.length,
      protocols: Object.fromEntries(
        ["vless", "vmess", "trojan", "ss", "hysteria2", "tuic"].map((p) => [
          p,
          nodes.filter((n) => n.protocol === p).length,
        ]),
      ),
      recent: [
        ...nodes.map((n) => ({ kind: "节点", name: n.name, at: n.updated_at })),
        ...subs.map((s) => ({ kind: "订阅", name: s.name, at: s.updated_at })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8),
    });
  });
  const publicSettings = () => {
    const settings = store.settings();
    return {
      site_name: String(settings.site_name || "dx-dy"),
      admin_base_url: options.adminBase,
      subscription_base_url: String(settings.subscription_base_url),
      default_format: String(settings.default_format || "v2ray"),
    };
  };
  app.get("/api/settings", (_req, res) => res.json(publicSettings()));
  app.put("/api/settings", (req, res) => {
    const x = z
      .object({
        site_name: z.string().min(1).max(80),
        default_format: z.enum(["raw", "v2ray", "shadowrocket"]),
        subscription_base_url: z.string().min(1).max(2048),
      })
      .parse(req.body);
    const nextBase = normalizeSubscriptionBase(
      x.subscription_base_url,
      !options.secure,
    );
    const previousHost = new URL(subscriptionBase()).host;
    store.transaction(() => {
      store.set("site_name", x.site_name);
      store.set("default_format", x.default_format);
    });
    const { nextHost } = setSubscriptionBase(store, nextBase, !options.secure);
    if (previousHost !== nextHost)
      console.info(
        JSON.stringify({
          event: "subscription_base_url_changed",
          old_host: previousHost,
          new_host: nextHost,
        }),
      );
    res.json({
      ok: true,
      subscription_base_url: nextBase,
    });
  });
  app.get(
    "/s/:token",
    limiter(options.subscriptionLimit ?? 300),
    (req, res) => {
      const token = String(req.params.token);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        return fail(404, "NOT_FOUND", "订阅不可用");
      const p = store.get(
        "SELECT * FROM subscriptions WHERE token_hash=? AND enabled=1",
        digest(token),
      );
      if (!p) return fail(404, "NOT_FOUND", "订阅不可用");
      const format = z
        .enum(["auto", "raw", "v2ray", "shadowrocket"])
        .parse(req.query.format || "auto");
      const selected = store.authorized(Number(p.id));
      const output = render(selected, format);
      if (output.suppressed.length)
        console.warn(
          JSON.stringify({
            event: "subscription_semantic_dedupe",
            subscription_id: Number(p.id),
            selected: selected.length,
            emitted: output.emitted.length,
            semantic_duplicates: output.suppressed.length,
          }),
        );
      res
        .set("Content-Type", output.contentType)
        .set("X-Subscription-Format", output.mode)
        .send(output.body);
    },
  );
  app.use("/api", (_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "接口不存在")),
  );
  // Network users can obtain Corresponding Source without authenticating.
  if (existsSync(path.resolve("dist/source.tar.gz")))
    app.get("/source.tar.gz", (_req, res) =>
      res.download(
        path.resolve("dist/source.tar.gz"),
        "dx-dy-0.2.5-source.tar.gz",
      ),
    );
  const web = options.webDir || path.resolve("dist/web");
  if (existsSync(web)) {
    app.use(express.static(web, { index: false }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(web, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const known = error instanceof ApiError;
      const invalid = error instanceof ZodError;
      const status = known ? error.status : invalid ? 400 : 500;
      // Never log request URLs, bodies or upstream exception messages.
      if (status === 500)
        console.error(
          JSON.stringify({ event: "request_error", code: "INTERNAL" }),
        );
      res.status(status).json({
        error: {
          code: known ? error.code : invalid ? "VALIDATION" : "INTERNAL",
          message: known
            ? error.message
            : invalid
              ? "输入参数不合法"
              : "操作失败，请检查输入或稍后重试",
          ...(known && error.details !== undefined
            ? { details: error.details }
            : {}),
        },
      });
    },
  );
  return { app, store };
}
