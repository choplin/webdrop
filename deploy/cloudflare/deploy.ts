import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { configureDeployment } from "./config.ts";
import { resolveAppDomain } from "./domain.ts";

type JsonObject = Record<string, unknown>;

interface CommandOptions {
	domain: string | undefined;
	dryRun: boolean;
}

function parseArguments(arguments_: string[]): CommandOptions {
	let domain: string | undefined;
	let dryRun = false;

	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--") {
			continue;
		}
		if (argument === "--dry-run") {
			dryRun = true;
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

	return { domain, dryRun };
}

function asObject(value: unknown, path: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as JsonObject;
}

async function run(command: string, arguments_: string[]): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, arguments_, {
			stdio: "inherit",
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
		configuration: configurationDomain,
	});
	const deployment = configureDeployment(config, appDomain);
	await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`);

	const wranglerArguments = [
		"exec",
		"wrangler",
		"deploy",
		"--config",
		configPath,
		"--strict",
	];
	if (options.dryRun) {
		wranglerArguments.push(
			"--dry-run",
			"--outdir",
			resolve(".wrangler/deploy-dry-run"),
		);
	}
	await run("pnpm", wranglerArguments);

	console.log(
		options.dryRun ? "Deployment dry-run passed." : "Deployment complete.",
	);
	console.log(`Application: https://${deployment.appDomain}`);
	console.log(`Published sites: https://${deployment.sitesDomain}`);
	console.log(`Worker: ${deployment.deploymentName}`);
	console.log(`R2 bucket: ${deployment.sitesBucketName}`);
	if (!options.dryRun) {
		console.log(
			"Access protection is optional; these domains are public by default.",
		);
	}
}

await main();
