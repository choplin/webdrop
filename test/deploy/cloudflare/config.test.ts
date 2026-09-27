import { describe, expect, it } from "vitest";
import { configureDeployment } from "../../../deploy/cloudflare/config";

describe("Cloudflare deployment configuration", () => {
	it("derives manual deployment resources from the application domain", () => {
		const config = {
			name: "webdrop",
			d1_databases: [{ binding: "AUTH_DB" }],
			r2_buckets: [{ binding: "SITES" }],
		};

		const deployment = configureDeployment(config, "webdrop.example.com");

		expect(deployment).toEqual({
			appDomain: "webdrop.example.com",
			authDatabaseName: "webdrop-example-com-auth",
			authentication: "google",
			deploymentName: "webdrop-example-com",
			sitesBucketName: "webdrop-example-com-sites",
			sitesDomain: "sites.webdrop.example.com",
		});
		expect(config).toMatchObject({
			name: "webdrop-example-com",
			d1_databases: [
				{ binding: "AUTH_DB", database_name: "webdrop-example-com-auth" },
			],
			vars: {
				APP_DOMAIN: "webdrop.example.com",
				AUTHENTICATION: "google",
			},
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
			d1_databases: [{ binding: "AUTH_DB" }],
			r2_buckets: [{ binding: "SITES" }],
		};

		const deployment = configureDeployment(config, "webdrop.example.com");

		expect(deployment.sitesBucketName).toBe("webdrop-example-com-sites");
		expect(config.r2_buckets[0]).toEqual({ binding: "SITES" });
	});

	it("rejects a generated config without the SITES binding", () => {
		expect(() =>
			configureDeployment(
				{
					name: "webdrop",
					d1_databases: [{ binding: "AUTH_DB" }],
					r2_buckets: [],
				},
				"webdrop.example.com",
			),
		).toThrow("no SITES R2 binding");
	});

	it("rejects a generated config without the AUTH_DB binding", () => {
		expect(() =>
			configureDeployment(
				{
					name: "webdrop",
					d1_databases: [],
					r2_buckets: [{ binding: "SITES" }],
				},
				"webdrop.example.com",
			),
		).toThrow("no AUTH_DB D1 binding");
	});

	it("removes authentication resources when the feature is disabled", () => {
		const config: Record<string, unknown> = {
			name: "webdrop",
			d1_databases: [{ binding: "AUTH_DB" }],
			r2_buckets: [{ binding: "SITES" }],
			secrets: {
				required: [
					"BETTER_AUTH_SECRET",
					"GOOGLE_CLIENT_ID",
					"GOOGLE_CLIENT_SECRET",
				],
			},
		};

		const deployment = configureDeployment(
			config,
			"webdrop.example.com",
			"disabled",
		);

		expect(deployment.authDatabaseName).toBeNull();
		expect(deployment.authentication).toBe("disabled");
		expect(config).not.toHaveProperty("d1_databases");
		expect(config).not.toHaveProperty("secrets");
		expect(config.vars).toEqual({
			APP_DOMAIN: "webdrop.example.com",
			AUTHENTICATION: "disabled",
		});
	});
});
