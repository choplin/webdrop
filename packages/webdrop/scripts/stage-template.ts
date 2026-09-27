import {
	access,
	copyFile,
	cp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as JsonObject;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const templateDirectory = join(packageDirectory, "template");
try {
	await access(join(repositoryRoot, "dist/webdrop/.dev.vars"));
	throw new Error("Build output must not contain .dev.vars");
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
const sourceConfig = asObject(
	JSON.parse(
		await readFile(join(repositoryRoot, "dist/webdrop/wrangler.json"), "utf8"),
	) as unknown,
	"generated Wrangler config",
);
const keys = [
	"assets",
	"compatibility_date",
	"compatibility_flags",
	"d1_databases",
	"main",
	"name",
	"no_bundle",
	"observability",
	"r2_buckets",
	"rules",
	"secrets",
	"triggers",
	"vars",
] as const;
const packagedConfig: JsonObject = {};
for (const key of keys) {
	if (sourceConfig[key] !== undefined) {
		packagedConfig[key] = sourceConfig[key];
	}
}
if (!Array.isArray(packagedConfig.d1_databases)) {
	throw new Error("generated Wrangler config d1_databases must be an array");
}
const authDatabase = packagedConfig.d1_databases
	.map((value, index) =>
		asObject(value, `generated Wrangler config d1_databases[${index}]`),
	)
	.find((database) => database.binding === "AUTH_DB");
if (authDatabase === undefined) {
	throw new Error("generated Wrangler config has no AUTH_DB D1 binding");
}
authDatabase.migrations_dir = "migrations";

await rm(templateDirectory, { force: true, recursive: true });
await mkdir(join(templateDirectory, "webdrop"), { recursive: true });
await cp(
	join(repositoryRoot, "dist/webdrop/assets"),
	join(templateDirectory, "webdrop/assets"),
	{ recursive: true },
);
await cp(
	join(repositoryRoot, "dist/webdrop/migrations"),
	join(templateDirectory, "webdrop/migrations"),
	{ recursive: true },
);
await cp(
	join(repositoryRoot, "dist/client"),
	join(templateDirectory, "client"),
	{ recursive: true },
);
await writeFile(
	join(templateDirectory, "webdrop/wrangler.json"),
	`${JSON.stringify(packagedConfig, null, "\t")}\n`,
);
await copyFile(
	join(repositoryRoot, "LICENSE"),
	join(packageDirectory, "LICENSE"),
);
