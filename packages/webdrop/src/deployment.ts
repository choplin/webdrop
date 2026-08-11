import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureDeployment } from "../../../deploy/cloudflare/config.ts";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as JsonObject;
}

async function runWrangler(
	configPath: string,
	dryRun: boolean,
	workingDirectory: string,
): Promise<void> {
	const require = createRequire(import.meta.url);
	const wranglerPackagePath = require.resolve("wrangler/package.json");
	const wranglerPath = resolve(dirname(wranglerPackagePath), "bin/wrangler.js");
	const arguments_ = [
		wranglerPath,
		"deploy",
		"--config",
		configPath,
		"--strict",
	];
	if (dryRun) {
		arguments_.push("--dry-run", "--outdir", join(workingDirectory, "output"));
	}

	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(process.execPath, arguments_, {
			cwd: workingDirectory,
			env: {
				...process.env,
				WRANGLER_LOG_PATH: join(workingDirectory, "wrangler.log"),
			},
			stdio: ["inherit", "pipe", "pipe"],
		});
		child.stdout.pipe(process.stderr);
		child.stderr.pipe(process.stderr);
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

export interface DeploymentResult {
	applicationUrl: string;
	deploymentName: string;
	dryRun: boolean;
	publishedSitesUrl: string;
	sitesBucketName: string;
}

export async function deployWebdrop(
	appDomain: string,
	dryRun: boolean,
): Promise<DeploymentResult> {
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
		const deployment = configureDeployment(config, appDomain);
		await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`);
		await runWrangler(configPath, dryRun, workingDirectory);

		return {
			applicationUrl: `https://${deployment.appDomain}`,
			deploymentName: deployment.deploymentName,
			dryRun,
			publishedSitesUrl: `https://${deployment.sitesDomain}`,
			sitesBucketName: deployment.sitesBucketName,
		};
	} finally {
		await rm(workingDirectory, { force: true, recursive: true });
	}
}
