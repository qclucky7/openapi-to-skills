#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";

const INPUT_DIR = "examples/input";
const OUTPUT_DIR = "examples/output";

async function getExtraArgs(spec: string): Promise<string[]> {
	const baseName = spec.replace(/\.(yaml|yml|json)$/, "");
	const argsFile = join(INPUT_DIR, `${baseName}.args.json`);
	if (existsSync(argsFile)) {
		const content = await readFile(argsFile, "utf-8");
		return JSON.parse(content);
	}
	return [];
}

async function main() {
	// Clean output directory
	await rm(OUTPUT_DIR, { recursive: true, force: true });

	// Get all input specs
	const files = await readdir(INPUT_DIR);
	const specs = files.filter(
		(f) =>
			(f.endsWith(".yaml") || f.endsWith(".json")) && !f.endsWith(".args.json"),
	);

	// Generate output for each
	for (const spec of specs) {
		consola.start(`Processing ${spec}`);
		const inputPath = join(INPUT_DIR, spec);
		const extraArgs = await getExtraArgs(spec);

		const proc = Bun.spawn(
			[
				"bun",
				"run",
				"src/cli.ts",
				inputPath,
				"-o",
				OUTPUT_DIR,
				"--force",
				...extraArgs,
			],
			{
				stdout: "inherit",
				stderr: "inherit",
			},
		);

		await proc.exited;
	}

	consola.success("Snapshots updated");
}

main();
