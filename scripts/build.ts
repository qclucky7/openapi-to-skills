import { cp, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);

await rm(dist, { recursive: true, force: true });

const tsc = Bun.spawn(["npx", "tsc"], { stdio: ["inherit", "inherit", "inherit"] });
const tscResult = await tsc.exited;
if (tscResult !== 0) process.exit(tscResult);

await cp(new URL("../templates/", import.meta.url), new URL("templates/", dist), { recursive: true });
