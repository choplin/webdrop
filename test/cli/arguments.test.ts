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
				"--json",
			]),
		).toEqual({
			action: "deploy",
			domain: "webdrop.example.com",
			dryRun: true,
			json: true,
		});
	});

	it("leaves a missing domain for the TTY prompt", () => {
		expect(parseArguments(["deploy"])).toEqual({
			action: "deploy",
			domain: undefined,
			dryRun: false,
			json: false,
		});
	});

	it("rejects unknown commands and missing flag values", () => {
		expect(() => parseArguments(["publish"])).toThrow("Unknown command");
		expect(() => parseArguments(["deploy", "--domain"])).toThrow(
			"--domain requires a hostname",
		);
	});
});
