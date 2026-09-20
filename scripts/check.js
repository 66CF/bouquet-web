import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const directory of ["js", "scripts", "tests"]) {
  for (const name of readdirSync(
    new URL(`../${directory}/`, import.meta.url),
  )) {
    if (!name.endsWith(".js")) continue;
    const file = new URL(`../${directory}/${name}`, import.meta.url);
    const result = spawnSync(
      process.execPath,
      ["--check", fileURLToPath(file)],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log("JavaScript syntax checks passed.");
