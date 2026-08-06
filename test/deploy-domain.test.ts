import { describe, expect, it } from "vitest";
import {
	deploymentNameFor,
	pagesDomainFor,
	resolveAppDomain,
	sitesBucketNameFor,
	validateAppDomain,
} from "../scripts/deploy-domain";

describe("deploy domain input", () => {
	it("normalizes one application domain and derives the pages domain", () => {
		expect(validateAppDomain(" Webdrop.Example.com. ")).toBe(
			"webdrop.example.com",
		);
		expect(pagesDomainFor("webdrop.example.com")).toBe(
			"pages.webdrop.example.com",
		);
	});

	it("derives Cloudflare resource names from the application domain", () => {
		expect(deploymentNameFor("webdrop.choplin.dev")).toBe(
			"webdrop-choplin-dev",
		);
		expect(sitesBucketNameFor("webdrop.choplin.dev")).toBe(
			"webdrop-choplin-dev-sites",
		);
	});

	it("keeps derived resource names within Cloudflare limits", () => {
		const domain = `${"a".repeat(50)}.${"b".repeat(50)}.example.com`;
		const deploymentName = deploymentNameFor(domain);

		expect(deploymentName).toHaveLength(58);
		expect(deploymentName).toMatch(/-[a-f0-9]{8}$/);
		expect(sitesBucketNameFor(domain)).toHaveLength(64);
	});

	it("accepts matching command, environment, and generated-config inputs", () => {
		expect(
			resolveAppDomain({
				argument: "webdrop.example.com",
				environment: "WEBDROP.EXAMPLE.COM",
				configuration: "webdrop.example.com",
			}),
		).toBe("webdrop.example.com");
	});

	it("ignores the template placeholder when another input is provided", () => {
		expect(
			resolveAppDomain({
				argument: "webdrop.example.com",
				environment: undefined,
				configuration: "webdrop.example.test",
			}),
		).toBe("webdrop.example.com");
	});

	it("rejects missing, conflicting, URL, wildcard, and single-label inputs", () => {
		expect(() =>
			resolveAppDomain({
				argument: undefined,
				environment: undefined,
				configuration: "webdrop.example.test",
			}),
		).toThrow("Pass --domain");
		expect(() =>
			resolveAppDomain({
				argument: "one.example.com",
				environment: "two.example.com",
				configuration: undefined,
			}),
		).toThrow("inputs disagree");
		expect(() => validateAppDomain("https://webdrop.example.com")).toThrow(
			"hostname",
		);
		expect(() => validateAppDomain("*.example.com")).toThrow("valid DNS");
		expect(() => validateAppDomain("localhost")).toThrow("valid DNS");
	});
});
