import { writeFileSync } from "node:fs";
import { git, forbidden } from "./release-utils.mjs";
const files = [
  ...new Set([
    ...git("ls-files", "-z").split("\0").filter(Boolean),
    "scripts/source-files.json",
  ]),
].sort();
if (files.some(forbidden))
  throw new Error(
    "Forbidden tracked artifact; refusing to create source inventory",
  );
writeFileSync(
  "scripts/source-files.json",
  JSON.stringify(files, null, 2) + "\n",
);
console.log(
  "Git source inventory refreshed: " +
    files.length +
    " files. Commit it with the source.",
);
