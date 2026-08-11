export interface DeployArguments {
	action: "deploy";
	domain: string | undefined;
	dryRun: boolean;
	json: boolean;
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

	return { action: "deploy", domain, dryRun, json };
}
