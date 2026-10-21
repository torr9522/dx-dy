import parsers from "../../vendor/sub-store/src/core/proxy-utils/parsers/index.js";
import URI from "../../vendor/sub-store/src/core/proxy-utils/producers/uri.js";
import Shadowrocket from "../../vendor/sub-store/src/core/proxy-utils/producers/shadowrocket.js";
import Mihomo from "../../vendor/sub-store/src/core/proxy-utils/producers/clashmeta.js";
import SingBox from "../../vendor/sub-store/src/core/proxy-utils/producers/sing-box.js";
import { lastParse } from "../../vendor/sub-store/src/normalize.js";
import { resetDiagnostics, getDiagnostics } from "./runtime.js";
export function parse(text) {
  resetDiagnostics();
  for (const p of parsers) {
    if (p.test(text)) {
      return { config: lastParse(p.parse(text)), warnings: getDiagnostics() };
    }
  }
  throw new Error("Unsupported URI");
}
export function uri(config) {
  return URI().produce(structuredClone(config));
}
export function shadowrocket(configs) {
  return Shadowrocket().produce(structuredClone(configs));
}
export function structuredFamily(configs, family) {
  resetDiagnostics();
  const producer = family === "mihomo" ? Mihomo() : SingBox();
  const output = producer.produce(structuredClone(configs), "internal", {
    "delete-underscore-fields": true,
  });
  return { output, warnings: getDiagnostics() };
}
