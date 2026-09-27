#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { resolveAppDomain } from "../../../deploy/cloudflare/domain.ts";
import {
	authenticationMode,
	loadDeployManifest,
	resolveManifestSecrets,
} from "../../../deploy/manifest.ts";
import packageMetadata from "../package.json" with { type: "json" };
import { parseArguments } from "./arguments.ts";
import { deployWebdrop } from "./deployment.ts";

const help = `Usage: webdrop <command> [options]

Commands:
  deploy              Deploy Webdrop to your Cloudflare account

Deploy options:
  --manifest <path>   Read desired deployment state (default: webdrop.yaml)
  --domain <hostname> Application hostname in an active Cloudflare zone
  --secrets-file <path> Upload required auth secrets during deployment
  --apply-migrations  Apply pending AUTH_DB migrations without confirmation
  --dry-run           Validate and build without changing Cloudflare
  --json              Print the result as JSON

General options:
  --help              Show this help
  --version           Show the version`;

async function promptForDomain(): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Pass --domain <hostname> when running without a terminal");
	}

	const prompt = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	try {
		return await prompt.question("Application hostname: ");
	} finally {
		prompt.close();
	}
}

async function main(): Promise<void> {
	const arguments_ = parseArguments(process.argv.slice(2));
	if (arguments_.action === "help") {
		process.stdout.write(`${help}\n`);
		return;
	}
	if (arguments_.action === "version") {
		process.stdout.write(`${packageMetadata.version}\n`);
		return;
	}

	const loadedManifest = await loadDeployManifest(arguments_.manifest);
	const authentication = authenticationMode(loadedManifest);
	const fallbackDomain =
		arguments_.domain === undefined && loadedManifest === undefined
			? await promptForDomain()
			: undefined;
	const appDomain = resolveAppDomain({
		argument: arguments_.domain ?? fallbackDomain,
		environment: undefined,
		configuration: loadedManifest?.manifest.target.hostname,
	});
	if (authentication === "disabled" && arguments_.secretsFile !== undefined) {
		throw new Error(
			"--secrets-file cannot be used when authentication is disabled",
		);
	}
	if (authentication === "disabled" && arguments_.applyMigrations) {
		throw new Error(
			"--apply-migrations cannot be used when authentication is disabled",
		);
	}
	const manifestSecrets =
		loadedManifest !== undefined && arguments_.secretsFile === undefined
			? await resolveManifestSecrets(loadedManifest)
			: undefined;
	process.stderr.write(
		arguments_.dryRun
			? `Validating a Webdrop deployment for ${appDomain}...\n`
			: `Deploying Webdrop to ${appDomain}...\n`,
	);
	const result = await deployWebdrop(appDomain, {
		applyMigrations: arguments_.applyMigrations,
		authentication,
		dryRun: arguments_.dryRun,
		manifestSecrets,
		secretsFile: arguments_.secretsFile,
	});

	if (arguments_.json) {
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} else if (!arguments_.dryRun) {
		process.stdout.write(`${result.applicationUrl}\n`);
	}
	process.stderr.write(
		arguments_.dryRun
			? "Deployment dry-run passed.\n"
			: `Deployment complete. Published sites use ${result.publishedSitesUrl}.\n`,
	);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`webdrop: ${message}\n`);
	process.exitCode = 1;
});
