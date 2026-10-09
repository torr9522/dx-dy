function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildShadowrocketSubscriptionLink(url: string, name: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("Subscription URL must use HTTP or HTTPS");
  return `shadowrocket://add/sub://${utf8Base64(parsed.toString())}?remark=${encodeURIComponent(name)}`;
}
