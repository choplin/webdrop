import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { parse } from "yaml";
import { validateAppDomain } from "./cloudflare/domain.ts";

const defaultManifestName = "webdrop.yaml";
const googleSecretNames = [
	"BETTER_AUTH_SECRET",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
] as const;

type Authentication = "disabled" | { provider: "google" };

interface EnvironmentSecretSource {
	source: "environment";
	name: string;
}

interface DotenvSecretSource {
	source: "dotenv";
	path: string;
	name: string;
}

type SecretSource = EnvironmentSecretSource | DotenvSecretSource;

export interface DeployManifest {
	version: 1;
	target: {
		provider: "cloudflare";
		hostname: string;
	};
	features: {
		authentication: Authentication;
	};
	secrets: Partial<Record<(typeof googleSecretNames)[number], SecretSource>>;
}

export interface LoadedDeployManifest {
	directory: string;
	manifest: DeployManifest;
	path: string;
}

export type AuthenticationMode = "disabled" | "google";

function asObject(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function onlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
): void {
	const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
	if (unknownKey !== undefined) {
		throw new Error(`${path}.${unknownKey} is not supported`);
	}
}

function nonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${path} must be a non-empty string`);
	}
	return value.trim();
}

function parseAuthentication(value: unknown): Authentication {
	if (value === "disabled") return "disabled";
	const authentication = asObject(value, "features.authentication");
	onlyKeys(authentication, ["provider"], "features.authentication");
	if (authentication.provider !== "google") {
		throw new Error(
			"features.authentication.provider must currently be google",
		);
	}
	return { provider: "google" };
}

function parseSecretSource(value: unknown, path: string): SecretSource {
	const source = asObject(value, path);
	const sourceType = source.source;
	if (sourceType === "environment") {
		onlyKeys(source, ["source", "name"], path);
		return {
			source: sourceType,
			name: nonEmptyString(source.name, `${path}.name`),
		};
	}
	if (sourceType === "dotenv") {
		onlyKeys(source, ["source", "path", "name"], path);
		return {
			source: sourceType,
			path: nonEmptyString(source.path, `${path}.path`),
			name: nonEmptyString(source.name, `${path}.name`),
		};
	}
	throw new Error(`${path}.source must be environment or dotenv`);
}

export function parseDeployManifest(source: string): DeployManifest {
	const document = asObject(parse(source) as unknown, "manifest");
	onlyKeys(document, ["version", "target", "features", "secrets"], "manifest");
	if (document.version !== 1) {
		throw new Error("manifest.version must be 1");
	}

	const target = asObject(document.target, "target");
	onlyKeys(target, ["provider", "hostname"], "target");
	if (target.provider !== "cloudflare") {
		throw new Error(
			`target.provider ${String(target.provider)} is not supported; use cloudflare`,
		);
	}

	const features = asObject(document.features, "features");
	onlyKeys(features, ["authentication"], "features");
	const authentication = parseAuthentication(features.authentication);
	const secretsObject =
		document.secrets === undefined ? {} : asObject(document.secrets, "secrets");
	onlyKeys(secretsObject, googleSecretNames, "secrets");
	const secrets: DeployManifest["secrets"] = {};
	for (const name of googleSecretNames) {
		if (secretsObject[name] !== undefined) {
			secrets[name] = parseSecretSource(secretsObject[name], `secrets.${name}`);
		}
	}

	if (authentication === "disabled" && Object.keys(secrets).length > 0) {
		throw new Error("secrets must be omitted when authentication is disabled");
	}
	if (authentication !== "disabled") {
		for (const name of googleSecretNames) {
			if (secrets[name] === undefined) {
				throw new Error(
					`secrets.${name} is required for Google authentication`,
				);
			}
		}
	}

	return {
		version: 1,
		target: {
			provider: "cloudflare",
			hostname: validateAppDomain(
				nonEmptyString(target.hostname, "target.hostname"),
			),
		},
		features: { authentication },
		secrets,
	};
}

export async function loadDeployManifest(
	explicitPath: string | undefined,
	workingDirectory = process.cwd(),
): Promise<LoadedDeployManifest | undefined> {
	const path = resolve(workingDirectory, explicitPath ?? defaultManifestName);
	if (explicitPath === undefined) {
		try {
			await access(path);
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return undefined;
			}
			throw error;
		}
	}

	return {
		directory: dirname(path),
		manifest: parseDeployManifest(await readFile(path, "utf8")),
		path,
	};
}

export function authenticationMode(
	loaded: LoadedDeployManifest | undefined,
): AuthenticationMode {
	return loaded?.manifest.features.authentication === "disabled"
		? "disabled"
		: "google";
}

export async function resolveManifestSecrets(
	loaded: LoadedDeployManifest,
	environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Record<string, string>> {
	if (loaded.manifest.features.authentication === "disabled") return {};

	const dotenvFiles = new Map<string, Record<string, string | undefined>>();
	const resolvedSecrets: Record<string, string> = {};
	for (const name of googleSecretNames) {
		const source = loaded.manifest.secrets[name];
		if (source === undefined) {
			throw new Error(`secrets.${name} is not configured`);
		}

		let value: string | undefined;
		if (source.source === "environment") {
			value = environment[source.name];
		} else {
			const path = resolve(loaded.directory, source.path);
			const cachedValues = dotenvFiles.get(path);
			const values = cachedValues ?? parseEnv(await readFile(path, "utf8"));
			if (cachedValues === undefined) dotenvFiles.set(path, values);
			value = values[source.name];
		}

		const normalizedValue = value?.trim();
		if (normalizedValue === undefined || normalizedValue === "") {
			throw new Error(`Secret source for ${name} did not provide a value`);
		}
		if (name === "BETTER_AUTH_SECRET" && normalizedValue.length < 32) {
			throw new Error(
				"Secret source for BETTER_AUTH_SECRET must provide at least 32 characters",
			);
		}
		resolvedSecrets[name] = normalizedValue;
	}
	return resolvedSecrets;
}
