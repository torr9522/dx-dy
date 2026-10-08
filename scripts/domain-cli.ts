import { readFileSync } from "node:fs";
import { Store } from "../apps/api/src/db";
import { setSubscriptionBase } from "../apps/api/src/domain-service";
import { validateDatabase } from "../apps/api/src/database-safety";

const command = process.argv[2];
if (command !== "set-subscription")
  throw new Error(
    "Usage: domain-cli set-subscription (HTTPS origin via stdin)",
  );
const database =
  process.env.DATABASE_PATH || "/data/private-subscription-manager.db";
const input = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
const store = new Store(database);
try {
  validateDatabase(store.db);
  const result = setSubscriptionBase(store, input);
  console.log(
    JSON.stringify({
      event: "subscription_domain_updated",
      previous_host: result.previousHost,
      current_host: result.nextHost,
    }),
  );
} finally {
  store.close();
}
