import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import ci from "ci-info";
import {
	authenticationMode,
	loadDeployManifest,
	resolveManifestSecrets,
} from "../manifest.ts";
import { configureDeployment } from "./config.ts";
import { resolveAppDomain } from "./domain.ts";
import { validateMigrationOptions } from "./migration-policy.ts";

type JsonObject = Record<string, unknown>;

interface CommandOptions {
	applyMigrations: boolean;
	domain: string | undefined;
	dryRun: boolean;
	manifest: string | undefined;
	secretsFile: string | undefined;
}

function parseArguments(arguments_: string[]): CommandOptions {
	let domain: string | undefined;
	let dryRun = false;
	let applyMigrations = false;
	let manifest: string | undefined;
	let secretsFile: string | undefined;

	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--") {
			continue;
		}
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (argument === "--apply-migrations") {
			applyMigrations = true;
			continue;
		}
		if (argument === "--manifest") {
			manifest = arguments_[index + 1];
			if (manifest === undefined || manifest.startsWith("--")) {
				throw new Error("--manifest requires a path");
			}
			index += 1;
			continue;
		}
		if (argument?.startsWith("--manifest=")) {
			manifest = argument.slice("--manifest=".length);
			continue;
		}
		if (argument === "--secrets-file") {
			secretsFile = arguments_[index + 1];
			if (secretsFile === undefined || secretsFile.startsWith("--")) {
				throw new Error("--secrets-file requires a path");
			}
			index += 1;
			continue;
		}
		if (argument?.startsWith("--secrets-file=")) {
			secretsFile = argument.slice("--secrets-file=".length);
			continue;
		}
		if (argument === "--domain") {
			domain = arguments_[index + 1];
			if (domain === undefined) {
				throw new Error("--domain requires a hostname");
			}
			index += 1;
			continue;
		}
		if (argument?.startsWith("--domain=")) {
			domain = argument.slice("--domain=".length);
			continue;
		}
		throw new Error(`Unknown deploy option: ${argument ?? ""}`);
	}

	if (dryRun && applyMigrations) {
		throw new Error("--apply-migrations cannot be combined with --dry-run");
	}

	return { applyMigrations, domain, dryRun, manifest, secretsFile };
}

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as JsonObject;
}

async function run(
	command: string,
	arguments_: string[],
	nonInteractive = false,
): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, arguments_, {
			stdio: [nonInteractive ? "ignore" : "inherit", "inherit", "inherit"],
			env: {
				...process.env,
				WRANGLER_LOG_PATH: resolve(".wrangler/wrangler-deploy.log"),
			},
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(
				new Error(
					signal === null
						? `${command} exited with status ${code ?? "unknown"}`
						: `${command} was terminated by ${signal}`,
				),
			);
		});
	});
}

async function generatedConfigPath(): Promise<string> {
	const manifestPath = resolve(".wrangler/deploy/config.json");
	const manifest = asObject(
		JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
		"generated deploy manifest",
	);
	if (typeof manifest.configPath !== "string") {
		throw new Error("The generated deploy manifest has no configPath");
	}
	return resolve(dirname(manifestPath), manifest.configPath);
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	await mkdir(".wrangler", { recursive: true });
	const loadedManifest = await loadDeployManifest(options.manifest);
	const authentication = authenticationMode(loadedManifest);
	if (authentication === "disabled" && options.secretsFile !== undefined) {
		throw new Error(
			"--secrets-file cannot be used when authentication is disabled",
		);
	}
	if (authentication === "disabled" && options.applyMigrations) {
		throw new Error(
			"--apply-migrations cannot be used when authentication is disabled",
		);
	}
	if (authentication === "google") {
		validateMigrationOptions(options, {
			inputIsTTY: process.stdin.isTTY === true,
			isCI: ci.isCI,
			outputIsTTY: process.stdout.isTTY === true,
		});
	}
	await run("pnpm", ["build"]);

	const configPath = await generatedConfigPath();
	const config = asObject(
		JSON.parse(await readFile(configPath, "utf8")) as unknown,
		"generated Wrangler config",
	);
	const vars = asObject(config.vars, "generated Wrangler config vars");
	const configurationDomain =
		typeof vars.APP_DOMAIN === "string" ? vars.APP_DOMAIN : undefined;
	const appDomain = resolveAppDomain({
		argument: options.domain,
		environment: process.env.APP_DOMAIN,
		configuration:
			loadedManifest?.manifest.target.hostname ?? configurationDomain,
	});
	const deployment = configureDeployment(config, appDomain, authentication);
	await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`);
	let generatedSecretsDirectory: string | undefined;
	let secretsFile = options.secretsFile;
	try {
		if (
			authentication === "google" &&
			loadedManifest !== undefined &&
			secretsFile === undefined
		) {
			const manifestSecrets = await resolveManifestSecrets(loadedManifest);
			generatedSecretsDirectory = await mkdtemp(
				resolve(".wrangler/webdrop-secrets-"),
			);
			secretsFile = join(generatedSecretsDirectory, "secrets.json");
			await writeFile(secretsFile, JSON.stringify(manifestSecrets), {
				mode: 0o600,
			});
		}

		const wranglerArguments = [
			"exec",
			"wrangler",
			"deploy",
			"--config",
			configPath,
			"--strict",
		];
		if (secretsFile !== undefined) {
			wranglerArguments.push("--secrets-file", resolve(secretsFile));
		}
		if (options.dryRun) {
			wranglerArguments.push(
				"--dry-run",
				"--outdir",
				resolve(".wrangler/deploy-dry-run"),
			);
		}

		await run("pnpm", wranglerArguments);
		if (!options.dryRun && authentication === "google") {
			await run(
				"pnpm",
				[
					"exec",
					"wrangler",
					"d1",
					"migrations",
					"apply",
					"AUTH_DB",
					"--remote",
					"--config",
					configPath,
				],
				options.applyMigrations,
			);
		}
	} finally {
		if (generatedSecretsDirectory !== undefined) {
			await rm(generatedSecretsDirectory, { force: true, recursive: true });
		}
	}

	console.log(
		options.dryRun ? "Deployment dry-run passed." : "Deployment complete.",
	);
	console.log(`Application: https://${deployment.appDomain}`);
	console.log(`Published sites: https://${deployment.sitesDomain}`);
	console.log(`Worker: ${deployment.deploymentName}`);
	console.log(`R2 bucket: ${deployment.sitesBucketName}`);
	if (deployment.authDatabaseName !== null) {
		console.log(`D1 database: ${deployment.authDatabaseName}`);
	}
	if (!options.dryRun) {
		console.log(
			"Access protection is optional; these domains are public by default.",
		);
	}
}

await main();
