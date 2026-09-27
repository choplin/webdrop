import { describe, expect, it } from "vitest";
import { validateMigrationOptions } from "../../../deploy/cloudflare/migration-policy";

describe("Cloudflare migration prompt policy", () => {
	it("allows an interactive deployment to prompt for pending migrations", () => {
		expect(() =>
			validateMigrationOptions(
				{ applyMigrations: false, dryRun: false },
				{ inputIsTTY: true, isCI: false, outputIsTTY: true },
			),
		).not.toThrow();
	});

	it("requires explicit approval for a non-interactive deployment", () => {
		expect(() =>
			validateMigrationOptions(
				{ applyMigrations: false, dryRun: false },
				{ inputIsTTY: false, isCI: false, outputIsTTY: false },
			),
		).toThrow("requires --apply-migrations");

		expect(() =>
			validateMigrationOptions(
				{ applyMigrations: true, dryRun: false },
				{ inputIsTTY: false, isCI: true, outputIsTTY: false },
			),
		).not.toThrow();
	});

	it("does not require a migration choice for a dry-run", () => {
		expect(() =>
			validateMigrationOptions(
				{ applyMigrations: false, dryRun: true },
				{ inputIsTTY: false, isCI: true, outputIsTTY: false },
			),
		).not.toThrow();
	});

	it("rejects redirected output and CI pseudo-terminals", () => {
		for (const terminal of [
			{ inputIsTTY: true, isCI: false, outputIsTTY: false },
			{ inputIsTTY: true, isCI: true, outputIsTTY: true },
		]) {
			expect(() =>
				validateMigrationOptions(
					{ applyMigrations: false, dryRun: false },
					terminal,
				),
			).toThrow("requires --apply-migrations");
		}
	});
});
