import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { preview } from "vite";

const secretNames = [
	"BETTER_AUTH_SECRET",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
] as const;

let localSecrets: Record<string, string | undefined> = {};
try {
	localSecrets = parseEnv(
		await readFile(
			process.env.WEBDROP_PREVIEW_VARS_PATH ?? ".dev.vars",
			"utf8",
		),
	);
} catch (error) {
	if (
		typeof error !== "object" ||
		error === null ||
		!("code" in error) ||
		error.code !== "ENOENT"
	) {
		throw error;
	}
}

for (const name of secretNames) {
	if (localSecrets[name] !== undefined) {
		process.env[name] = localSecrets[name];
	}
}

await preview();
