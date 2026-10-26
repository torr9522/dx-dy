export type RendererFamily = "generic" | "mihomo" | "singbox";
export const clientProfiles = [
  { id: "generic", name: "Generic / Base64", family: "generic" },
  { id: "v2rayn", name: "v2rayN", family: "generic" },
  { id: "clash-meta", name: "Clash Meta / Mihomo", family: "mihomo" },
  { id: "clash-verge", name: "Clash Verge Rev", family: "mihomo" },
  { id: "flclash", name: "FlClash", family: "mihomo" },
  { id: "clash-nyanpasu", name: "Clash Nyanpasu", family: "mihomo" },
  { id: "clash-party", name: "Clash Party", family: "mihomo" },
  { id: "mihomo", name: "Mihomo", family: "mihomo" },
  { id: "singbox", name: "sing-box", family: "singbox" },
] as const satisfies readonly {
  id: string;
  name: string;
  family: RendererFamily;
}[];
export type ClientProfile = (typeof clientProfiles)[number];
