declare module "*generated/upstream.mjs" {
  export function parse(text: string): {
    config: Record<string, unknown>;
    warnings: string[];
  };
  export function uri(config: Record<string, unknown>): string;
  export function shadowrocket(configs: Record<string, unknown>[]): string;
  export function structuredFamily(
    configs: Record<string, unknown>[],
    family: "mihomo" | "singbox",
  ): { output: Record<string, unknown>[]; warnings: string[] };
}
