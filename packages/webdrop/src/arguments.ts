export interface DeployArguments {
	action: "deploy";
	applyMigrations: boolean;
	domain: string | undefined;
	dryRun: boolean;
	json: boolean;
	manifest: string | undefined;
	secretsFile: string | undefined;
}

export type CliArguments =
	| DeployArguments
	| { action: "help" }
	| { action: "version" };

export function parseArguments(arguments_: string[]): CliArguments {
	if (arguments_.length === 0 || arguments_[0] === "--help") {
		return { action: "help" };
	}
	if (arguments_[0] === "--version") {
		return { action: "version" };
	}
	if (arguments_[0] !== "deploy") {
		throw new Error(`Unknown command: ${arguments_[0]}`);
	}

	let domain: string | undefined;
	let dryRun = false;
	let json = false;
	let applyMigrations = false;
	let manifest: string | undefined;
	let secretsFile: string | undefined;

	for (let index = 1; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--help") {
			return { action: "help" };
		}
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (argument === "--json") {
			json = true;
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
			if (domain === undefined || domain.startsWith("--")) {
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

	return {
		action: "deploy",
		applyMigrations,
		domain,
		dryRun,
		json,
		manifest,
		secretsFile,
	};
}
