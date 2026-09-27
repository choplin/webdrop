import { describe, expect, it } from "vitest";
import { parseArguments } from "../../packages/webdrop/src/arguments";

describe("webdrop CLI arguments", () => {
	it("parses a scriptable one-shot deployment", () => {
		expect(
			parseArguments([
				"deploy",
				"--domain",
				"webdrop.example.com",
				"--dry-run",
				"--secrets-file",
				"auth.env",
				"--manifest",
				"deploy.yaml",
				"--json",
			]),
		).toEqual({
			action: "deploy",
			applyMigrations: false,
			domain: "webdrop.example.com",
			dryRun: true,
			json: true,
			manifest: "deploy.yaml",
			secretsFile: "auth.env",
		});
	});

	it("leaves a missing domain for the TTY prompt", () => {
		expect(parseArguments(["deploy"])).toEqual({
			action: "deploy",
			applyMigrations: false,
			domain: undefined,
			dryRun: false,
			json: false,
			manifest: undefined,
			secretsFile: undefined,
		});
	});

	it("accepts explicit non-interactive migration approval", () => {
		expect(parseArguments(["deploy", "--apply-migrations"])).toMatchObject({
			action: "deploy",
			applyMigrations: true,
			dryRun: false,
		});
	});

	it("rejects unknown commands and missing flag values", () => {
		expect(() => parseArguments(["publish"])).toThrow("Unknown command");
		expect(() => parseArguments(["deploy", "--domain"])).toThrow(
			"--domain requires a hostname",
		);
		expect(() => parseArguments(["deploy", "--secrets-file"])).toThrow(
			"--secrets-file requires a path",
		);
		expect(() => parseArguments(["deploy", "--manifest"])).toThrow(
			"--manifest requires a path",
		);
		expect(() =>
			parseArguments(["deploy", "--dry-run", "--apply-migrations"]),
		).toThrow("cannot be combined");
	});
});
