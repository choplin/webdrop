import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ci from "ci-info";
import { configureDeployment } from "../../../deploy/cloudflare/config.ts";
import { validateMigrationOptions } from "../../../deploy/cloudflare/migration-policy.ts";
import type { AuthenticationMode } from "../../../deploy/manifest.ts";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as JsonObject;
}

async function runWrangler(
	arguments_: string[],
	workingDirectory: string,
	nonInteractive = false,
): Promise<void> {
	const require = createRequire(import.meta.url);
	const wranglerPackagePath = require.resolve("wrangler/package.json");
	const wranglerPath = resolve(dirname(wranglerPackagePath), "bin/wrangler.js");

	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(process.execPath, [wranglerPath, ...arguments_], {
			cwd: workingDirectory,
			env: {
				...process.env,
				WRANGLER_LOG_PATH: join(workingDirectory, "wrangler.log"),
			},
			stdio: [
				nonInteractive ? "ignore" : "inherit",
				nonInteractive ? "pipe" : process.stderr,
				"pipe",
			],
		});
		child.stdout?.pipe(process.stderr);
		child.stderr?.pipe(process.stderr);
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(
				new Error(
					signal === null
						? `Wrangler exited with status ${code ?? "unknown"}`
						: `Wrangler was terminated by ${signal}`,
				),
			);
		});
	});
}

interface DeployOptions {
	applyMigrations: boolean;
	authentication: AuthenticationMode;
	dryRun: boolean;
	manifestSecrets: Record<string, string> | undefined;
	secretsFile: string | undefined;
}

function deployArguments(
	configPath: string,
	workingDirectory: string,
	options: DeployOptions,
): string[] {
	const arguments_ = ["deploy", "--config", configPath, "--strict"];
	if (options.secretsFile !== undefined) {
		arguments_.push("--secrets-file", resolve(options.secretsFile));
	}
	if (options.dryRun) {
		arguments_.push("--dry-run", "--outdir", join(workingDirectory, "output"));
	}
	return arguments_;
}

export interface DeploymentResult {
	applicationUrl: string;
	authDatabaseName: string | null;
	authentication: AuthenticationMode;
	deploymentName: string;
	dryRun: boolean;
	publishedSitesUrl: string;
	sitesBucketName: string;
}

export async function deployWebdrop(
	appDomain: string,
	options: DeployOptions,
): Promise<DeploymentResult> {
	if (options.authentication === "google") {
		validateMigrationOptions(options, {
			inputIsTTY: process.stdin.isTTY === true,
			isCI: ci.isCI,
			outputIsTTY: process.stderr.isTTY === true,
		});
	}
	const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
	const templateDirectory = join(packageDirectory, "template");
	const workingDirectory = resolve(
		await mkdtemp(join(tmpdir(), "webdrop-deploy-")),
	);

	try {
		await cp(templateDirectory, workingDirectory, { recursive: true });
		const configPath = join(workingDirectory, "webdrop/wrangler.json");
		const config = asObject(
			JSON.parse(await readFile(configPath, "utf8")) as unknown,
			"packaged Wrangler config",
		);
		const deployment = configureDeployment(
			config,
			appDomain,
			options.authentication,
		);
		await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`);
		let secretsFile = options.secretsFile;
		if (options.manifestSecrets !== undefined) {
			secretsFile = join(workingDirectory, "webdrop-secrets.json");
			await writeFile(secretsFile, JSON.stringify(options.manifestSecrets), {
				mode: 0o600,
			});
		}
		await runWrangler(
			deployArguments(configPath, workingDirectory, {
				...options,
				secretsFile,
			}),
			workingDirectory,
		);
		if (!options.dryRun && options.authentication === "google") {
			await runWrangler(
				[
					"d1",
					"migrations",
					"apply",
					"AUTH_DB",
					"--remote",
					"--config",
					configPath,
				],
				workingDirectory,
				options.applyMigrations,
			);
		}

		return {
			applicationUrl: `https://${deployment.appDomain}`,
			authDatabaseName: deployment.authDatabaseName,
			authentication: deployment.authentication,
			deploymentName: deployment.deploymentName,
			dryRun: options.dryRun,
			publishedSitesUrl: `https://${deployment.sitesDomain}`,
			sitesBucketName: deployment.sitesBucketName,
		};
	} finally {
		await rm(workingDirectory, { force: true, recursive: true });
	}
}
