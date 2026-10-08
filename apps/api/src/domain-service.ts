import { Store } from "./db";

export function normalizeHttpsOrigin(
  input: string,
  allowInsecureLocalhost = false,
) {
  const url = new URL(input.trim());
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(allowInsecureLocalhost && local))
    throw new Error("Origin must use HTTPS");
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Origin must not contain credentials, path, query or fragment",
    );
  return url.origin;
}

export function setSubscriptionBase(
  store: Store,
  input: string,
  allowInsecureLocalhost = false,
) {
  const nextBase = normalizeHttpsOrigin(input, allowInsecureLocalhost);
  const previousBase = String(store.settings().subscription_base_url || "");
  const previousHost = previousBase ? new URL(previousBase).host : "";
  const nextHost = new URL(nextBase).host;
  const storedLegacyHosts = store.settings().subscription_legacy_hosts;
  const legacyHosts = Array.isArray(storedLegacyHosts)
    ? storedLegacyHosts.map(String)
    : [];
  if (
    previousHost &&
    previousHost !== nextHost &&
    !legacyHosts.includes(previousHost)
  )
    legacyHosts.push(previousHost);
  store.transaction(() => {
    store.set("subscription_base_url", nextBase);
    store.set("subscription_legacy_hosts", legacyHosts);
  });
  return { previousHost, nextHost, nextBase };
}
