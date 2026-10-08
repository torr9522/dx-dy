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
import { existsSync } from "node:fs";
import { Store, now } from "./db";
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
  parseNode,
  preview,
} from "../../../packages/proxy-adapter";
export type Options = {
  database: string;
  masterKey: string;
  initialPassword: string;
  username?: string;
  secure?: boolean;
  publicBase: string;
  trustProxy?: number;
  loginLimit?: number;
  subscriptionLimit?: number;
  webDir?: string;
};
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
  if (!store.get("SELECT id FROM admins")) {
    if (options.initialPassword.length < 20)
      throw new Error("Initial password must be at least 20 characters");
    store.run(
      "INSERT INTO admins VALUES(1,?,?,?,?)",
      options.username || "admin",
      await argon2.hash(options.initialPassword, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
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
    res.json({ status: "ok", database: "ok", version: "0.1.2" });
  });
  app.post(
    "/api/auth/login",
    limiter(options.loginLimit ?? 15),
    async (req, res) => {
      if (req.headers.origin && req.headers.origin !== options.publicBase)
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
      if (req.headers.origin && req.headers.origin !== options.publicBase)
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
      .object({ current: z.string(), password: z.string().min(12).max(200) })
      .parse(req.body);
    const admin = store.get("SELECT * FROM admins WHERE id=1");
    if (!(await argon2.verify(String(admin?.password_hash), x.current)))
      return fail(400, "PASSWORD", "当前密码错误");
    store.transaction(() => {
      store.run("DELETE FROM admin_sessions");
    });
    store.run(
      "UPDATE admins SET password_hash=?,updated_at=? WHERE id=1",
      await argon2.hash(x.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      now(),
    );
    res.clearCookie("psm_session", cookie).json({ ok: true });
  });
  app.get("/api/nodes", (_req, res) => res.json(store.nodes()));
  app.post("/api/nodes/preview", (req, res) => {
    const { text } = z
      .object({ text: z.string().min(1).max(200000) })
      .parse(req.body);
    if (text.split("\n").length > 300)
      return fail(400, "LIMIT", "每批最多 300 行");
    res.json(preview(text, store.nodes()));
  });
  app.post("/api/nodes/import", (req, res) => {
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
    const parsed = items.map((x) => {
      const e = parseURI(x.uri);
      if (x.name) e.normalized_config.name = x.name;
      return e;
    });
    const ids = store.transaction(() => parsed.map((e) => store.addNode(e)));
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
    const e = editConfig(n, x.normalized_config);
    generateURI(e);
    store.updateNode(n.id, e, x.remark, x.tags, x.enabled);
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
    if (
      n.references &&
      !z.object({ confirm: z.literal(true) }).safeParse(req.body).success
    )
      return fail(
        409,
        "REFERENCED",
        `该节点被 ${n.references} 个订阅引用，请确认删除`,
      );
    store.run("DELETE FROM nodes WHERE id=?", n.id);
    res.json({ ok: true });
  });
  const getProfile = (req: Request) =>
    store.get("SELECT * FROM subscriptions WHERE id=?", id(req)) ||
    fail(404, "NOT_FOUND", "订阅不存在");
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
    if (node_ids.some((n) => !store.findNode(n)))
      return fail(400, "NODE", "含不存在的节点");
    store.assign(id(req), node_ids);
    res.json(store.profile(getProfile(req)));
  });
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
    const base = String(store.settings().public_base_url || options.publicBase);
    res.json({ url: `${base}/s/${token}` });
  });
  const render = (nodes: Envelope[], format: string) => ({
    body:
      format === "raw"
        ? generateUniversalUriLines(nodes)
        : generateUniversalBase64Subscription(nodes),
    contentType: "text/plain; charset=utf-8",
    mode: format === "raw" ? "raw" : "universal-base64",
  });
  app.get("/api/subscriptions/:id/preview", (req, res) => {
    const p = getProfile(req);
    const f = z
      .enum(["auto", "raw", "v2ray", "shadowrocket"])
      .parse(req.query.format || "auto");
    const nodes = store.authorized(Number(p.id));
    res.json({
      ...render(nodes, f),
      decoded: generateUniversalUriLines(nodes),
      nodes: nodes.map((node) => ({
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
  app.get("/api/settings", (_req, res) =>
    res.json({
      site_name: "私人节点库",
      public_base_url: options.publicBase,
      default_format: "v2ray",
      ...store.settings(),
    }),
  );
  app.put("/api/settings", (req, res) => {
    const x = z
      .object({
        site_name: z.string().min(1).max(80),
        public_base_url: z
          .url()
          .refine(
            (v) =>
              /^https?:\/\//.test(v) &&
              !new URL(v).username &&
              !new URL(v).password &&
              !new URL(v).search &&
              !new URL(v).hash &&
              new URL(v).pathname === "/",
          ),
        default_format: z.enum(["raw", "v2ray", "shadowrocket"]),
      })
      .parse(req.body);
    store.transaction(() =>
      Object.entries(x).forEach(([k, v]) =>
        store.set(k, k === "public_base_url" ? v.replace(/\/$/, "") : v),
      ),
    );
    res.json({ ok: true });
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
      const output = render(store.authorized(Number(p.id)), format);
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
        "private-subscription-manager-0.1.2-source.tar.gz",
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
        },
      });
    },
  );
  return { app, store };
}
