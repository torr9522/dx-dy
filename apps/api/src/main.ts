import { createApp } from "./app";
import { databaseLock } from "./database-lock";
const database =
  process.env.DATABASE_PATH || "/data/private-subscription-manager.db";
const releaseLock = await databaseLock(database);
const { app, store } = await createApp({
  database,
  masterKey: process.env.APP_MASTER_KEY || "",
  initialPassword: process.env.ADMIN_INITIAL_PASSWORD || "",
  username: process.env.ADMIN_USERNAME,
  secure: process.env.COOKIE_SECURE === "true",
  adminBase: (process.env.ADMIN_BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  ),
  subscriptionBase: (
    process.env.SUBSCRIPTION_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, ""),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
});
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "0.0.0.0",
  () => console.log(JSON.stringify({ event: "ready", version: "0.1.6" })),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => {
      store.close();
      releaseLock();
      process.exit(0);
    });
    server.closeAllConnections();
  });
