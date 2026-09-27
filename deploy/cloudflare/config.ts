import type { AuthenticationMode } from "../manifest.ts";
import {
	deploymentNameFor,
	sitesBucketNameFor,
	sitesDomainFor,
} from "./domain.ts";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as JsonObject;
}

function sitesBucket(config: JsonObject): JsonObject {
	if (!Array.isArray(config.r2_buckets)) {
		throw new Error("generated Wrangler config r2_buckets must be an array");
	}

	const bucket = config.r2_buckets
		.map((value, index) =>
			asObject(value, `generated Wrangler config r2_buckets[${index}]`),
		)
		.find((value) => value.binding === "SITES");
	if (bucket === undefined) {
		throw new Error("generated Wrangler config has no SITES R2 binding");
	}

	return bucket;
}

function authDatabase(config: JsonObject): JsonObject {
	if (!Array.isArray(config.d1_databases)) {
		throw new Error("generated Wrangler config d1_databases must be an array");
	}

	const database = config.d1_databases
		.map((value, index) =>
			asObject(value, `generated Wrangler config d1_databases[${index}]`),
		)
		.find((value) => value.binding === "AUTH_DB");
	if (database === undefined) {
		throw new Error("generated Wrangler config has no AUTH_DB D1 binding");
	}

	return database;
}

export interface DeploymentConfiguration {
	appDomain: string;
	authDatabaseName: string | null;
	authentication: AuthenticationMode;
	deploymentName: string;
	sitesBucketName: string;
	sitesDomain: string;
}

export function configureDeployment(
	config: JsonObject,
	appDomain: string,
	authentication: AuthenticationMode = "google",
): DeploymentConfiguration {
	const deploymentName = deploymentNameFor(appDomain);
	const sitesDomain = sitesDomainFor(appDomain);
	const bucket = sitesBucket(config);
	const configuredBucketName =
		typeof bucket.bucket_name === "string" ? bucket.bucket_name.trim() : "";
	const sitesBucketName =
		configuredBucketName !== ""
			? configuredBucketName
			: sitesBucketNameFor(appDomain);
	let authDatabaseName: string | null = null;
	if (authentication === "google") {
		const database = authDatabase(config);
		const configuredDatabaseName =
			typeof database.database_name === "string"
				? database.database_name.trim()
				: "";
		authDatabaseName =
			configuredDatabaseName !== ""
				? configuredDatabaseName
				: `${deploymentName}-auth`;
		database.database_name = authDatabaseName;
	} else {
		delete config.d1_databases;
		delete config.secrets;
	}

	config.name = deploymentName;
	config.vars = { APP_DOMAIN: appDomain, AUTHENTICATION: authentication };
	config.workers_dev = false;
	config.preview_urls = false;
	config.routes = [
		{ pattern: appDomain, custom_domain: true },
		{ pattern: sitesDomain, custom_domain: true },
	];

	return {
		appDomain,
		authDatabaseName,
		authentication,
		deploymentName,
		sitesBucketName,
		sitesDomain,
	};
}
