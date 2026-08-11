#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { validateAppDomain } from "../../../deploy/cloudflare/domain.ts";
import packageMetadata from "../package.json" with { type: "json" };
import { parseArguments } from "./arguments.ts";
import { deployWebdrop } from "./deployment.ts";

const help = `Usage: webdrop <command> [options]

Commands:
  deploy              Deploy Webdrop to your Cloudflare account

Deploy options:
  --domain <hostname> Application hostname in an active Cloudflare zone
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

	const appDomain = validateAppDomain(
		arguments_.domain ?? (await promptForDomain()),
	);
	process.stderr.write(
		arguments_.dryRun
			? `Validating a Webdrop deployment for ${appDomain}...\n`
			: `Deploying Webdrop to ${appDomain}...\n`,
	);
	const result = await deployWebdrop(appDomain, arguments_.dryRun);

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
