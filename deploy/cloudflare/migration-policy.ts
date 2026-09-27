export interface MigrationOptions {
	applyMigrations: boolean;
	dryRun: boolean;
}

export interface MigrationTerminal {
	inputIsTTY: boolean;
	isCI: boolean;
	outputIsTTY: boolean;
}

export function validateMigrationOptions(
	options: MigrationOptions,
	terminal: MigrationTerminal,
): void {
	const interactive =
		terminal.inputIsTTY && terminal.outputIsTTY && !terminal.isCI;
	if (!options.dryRun && !options.applyMigrations && !interactive) {
		throw new Error("Non-interactive deployment requires --apply-migrations");
	}
}
