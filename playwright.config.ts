import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3100", headless: true, trace: "off" },
  webServer: {
    command: "exec node dist/server.mjs",
    url: "http://127.0.0.1:3100/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    env: {
      PORT: "3100",
      HOST: "127.0.0.1",
      DATABASE_PATH: `test-results/e2e-${Date.now()}.sqlite`,
      APP_MASTER_KEY: "2".repeat(64),
      ADMIN_INITIAL_PASSWORD: "Synthetic-e2e-password-123!",
      PUBLIC_BASE_URL: "http://127.0.0.1:3100",
      COOKIE_SECURE: "false",
      TRUST_PROXY: "0",
    },
  },
});
