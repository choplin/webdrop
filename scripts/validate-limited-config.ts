import { readFile } from "node:fs/promises";

type JsonObject = Record<string, unknown>;

const placeholderValues = new Set([
	"00000000000000000000000000000000",
	"webdrop.example.invalid",
	"pages.webdrop.example.invalid",
	"replace-with-limited-bucket",
]);

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}

	return value as JsonObject;
}

function asArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} must be an array`);
	}

	return value;
}

function asString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${path} must be a non-empty string`);
	}

	return value;
}

function requireConcrete(value: string, path: string): void {
	if (placeholderValues.has(value)) {
		throw new Error(`${path} still contains the template placeholder`);
	}
}

function requireExactKeys(
	value: JsonObject,
	expectedKeys: string[],
	path: string,
): void {
	const expected = new Set(expectedKeys);
	const actual = Object.keys(value);
	const missing = expectedKeys.filter((key) => !(key in value));
	const unexpected = actual.filter((key) => !expected.has(key));
	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`${path} keys differ (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
		);
	}
}

function validateHostname(value: string, path: string): void {
	requireConcrete(value, path);
	if (
		value.includes("/") ||
		value.includes("*") ||
		!value.includes(".") ||
		value !== value.toLowerCase()
	) {
		throw new Error(
			`${path} must be a lowercase hostname without a path or wildcard`,
		);
	}
}

function validateConfig(value: unknown): void {
	const config = asObject(value, "config");
	requireExactKeys(
		config,
		[
			"$schema",
			"name",
			"main",
			"compatibility_date",
			"compatibility_flags",
			"account_id",
			"workers_dev",
			"preview_urls",
			"routes",
			"observability",
			"triggers",
			"assets",
			"vars",
			"r2_buckets",
		],
		"config",
	);
	if (config.name !== "webdrop-limited") {
		throw new Error("name must be webdrop-limited");
	}
	if (config.main !== "../../src/worker.ts") {
		throw new Error("main must reference the reviewed Worker entry point");
	}
	if (config.compatibility_date !== "2026-07-26") {
		throw new Error(
			"compatibility_date must match the reviewed Worker runtime",
		);
	}
	const compatibilityFlags = asArray(
		config.compatibility_flags,
		"compatibility_flags",
	);
	if (
		compatibilityFlags.length !== 1 ||
		compatibilityFlags[0] !== "nodejs_compat"
	) {
		throw new Error("compatibility_flags must contain only nodejs_compat");
	}
	const accountId = asString(config.account_id, "account_id");
	requireConcrete(accountId, "account_id");
	if (!/^[0-9a-f]{32}$/i.test(accountId)) {
		throw new Error("account_id must be a 32-character Cloudflare account ID");
	}

	if (config.workers_dev !== false) {
		throw new Error("workers_dev must be false");
	}
	if (config.preview_urls !== false) {
		throw new Error("preview_urls must be false");
	}

	const vars = asObject(config.vars, "vars");
	requireExactKeys(vars, ["CONTROL_HOSTNAME", "PAGES_HOSTNAME"], "vars");
	const controlHostname = asString(
		vars.CONTROL_HOSTNAME,
		"vars.CONTROL_HOSTNAME",
	);
	const pagesHostname = asString(vars.PAGES_HOSTNAME, "vars.PAGES_HOSTNAME");
	validateHostname(controlHostname, "vars.CONTROL_HOSTNAME");
	validateHostname(pagesHostname, "vars.PAGES_HOSTNAME");
	if (controlHostname === pagesHostname) {
		throw new Error("control and pages hostnames must be different origins");
	}
	if (pagesHostname !== `pages.${controlHostname}`) {
		throw new Error(
			"pages hostname must be pages.<application hostname> so the app remains at the configured domain root",
		);
	}

	const routes = asArray(config.routes, "routes");
	if (routes.length !== 2) {
		throw new Error(
			"routes must contain exactly the control and pages custom domains",
		);
	}
	const routePatterns = new Set(
		routes.map((route, index) => {
			const routeObject = asObject(route, `routes[${index}]`);
			requireExactKeys(
				routeObject,
				["pattern", "custom_domain"],
				`routes[${index}]`,
			);
			if (routeObject.custom_domain !== true) {
				throw new Error(`routes[${index}].custom_domain must be true`);
			}
			return asString(routeObject.pattern, `routes[${index}].pattern`);
		}),
	);
	if (
		routePatterns.size !== 2 ||
		!routePatterns.has(controlHostname) ||
		!routePatterns.has(pagesHostname)
	) {
		throw new Error(
			"custom-domain routes must exactly match the two hostname variables",
		);
	}

	const buckets = asArray(config.r2_buckets, "r2_buckets");
	if (buckets.length !== 1) {
		throw new Error("r2_buckets must contain exactly one binding");
	}
	const bucket = asObject(buckets[0], "r2_buckets[0]");
	requireExactKeys(bucket, ["binding", "bucket_name"], "r2_buckets[0]");
	if (bucket.binding !== "SITES") {
		throw new Error("r2_buckets[0].binding must be SITES");
	}
	const bucketName = asString(bucket.bucket_name, "r2_buckets[0].bucket_name");
	requireConcrete(bucketName, "r2_buckets[0].bucket_name");

	const triggers = asObject(config.triggers, "triggers");
	requireExactKeys(triggers, ["crons"], "triggers");
	const crons = asArray(triggers.crons, "triggers.crons");
	if (crons.length !== 1 || crons[0] !== "0 3 * * *") {
		throw new Error(
			"triggers.crons must contain only the daily 03:00 UTC cleanup",
		);
	}

	const assets = asObject(config.assets, "assets");
	requireExactKeys(
		assets,
		["binding", "directory", "run_worker_first"],
		"assets",
	);
	if (
		assets.binding !== "ASSETS" ||
		assets.directory !== "../../dist" ||
		assets.run_worker_first !== true
	) {
		throw new Error("assets must bind the reviewed production build as ASSETS");
	}

	const observability = asObject(config.observability, "observability");
	requireExactKeys(observability, ["enabled"], "observability");
	if (observability.enabled !== true) {
		throw new Error("observability.enabled must be true");
	}
}

const configPath = process.argv[2];
if (!configPath) {
	throw new Error(
		"usage: node scripts/validate-limited-config.ts <wrangler-config>",
	);
}

const source = await readFile(configPath, "utf8");
const parsed: unknown = JSON.parse(source);
validateConfig(parsed);
console.log(`Validated limited Cloudflare targets in ${configPath}`);
