import { describe, expect, it } from "vitest";
import { configureDeployment } from "../../../deploy/cloudflare/config";

describe("Cloudflare deployment configuration", () => {
	it("derives manual deployment resources from the application domain", () => {
		const config = {
			name: "webdrop",
			r2_buckets: [{ binding: "SITES" }],
		};

		const deployment = configureDeployment(config, "webdrop.example.com");

		expect(deployment).toEqual({
			appDomain: "webdrop.example.com",
			deploymentName: "webdrop-example-com",
			sitesBucketName: "webdrop-example-com-sites",
			sitesDomain: "sites.webdrop.example.com",
		});
		expect(config).toMatchObject({
			name: "webdrop-example-com",
			vars: { APP_DOMAIN: "webdrop.example.com" },
			r2_buckets: [{ binding: "SITES" }],
			routes: [
				{ pattern: "webdrop.example.com", custom_domain: true },
				{ pattern: "sites.webdrop.example.com", custom_domain: true },
			],
		});
	});

	it("keeps automatic R2 provisioning enabled", () => {
		const config = {
			name: "selected-webdrop",
			r2_buckets: [{ binding: "SITES" }],
		};

		const deployment = configureDeployment(config, "webdrop.example.com");

		expect(deployment.sitesBucketName).toBe("webdrop-example-com-sites");
		expect(config.r2_buckets[0]).toEqual({ binding: "SITES" });
	});

	it("rejects a generated config without the SITES binding", () => {
		expect(() =>
			configureDeployment(
				{ name: "webdrop", r2_buckets: [] },
				"webdrop.example.com",
			),
		).toThrow("no SITES R2 binding");
	});
});
