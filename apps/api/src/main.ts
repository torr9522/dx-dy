import { createApp } from "./app";
const { app, store } = await createApp({
  database: process.env.DATABASE_PATH || "data/app.sqlite",
  masterKey: process.env.APP_MASTER_KEY || "",
  initialPassword: process.env.ADMIN_INITIAL_PASSWORD || "",
  username: process.env.ADMIN_USERNAME,
  secure: process.env.COOKIE_SECURE === "true",
  publicBase: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
  trustProxy: Number(process.env.TRUST_PROXY || 0),
});
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "0.0.0.0",
  () => console.log(JSON.stringify({ event: "ready", version: "0.1.3" })),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
