import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			miniflare: {
				bindings: {
					BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
					GOOGLE_CLIENT_ID: "test-google-client-id",
					GOOGLE_CLIENT_SECRET: "test-google-client-secret",
					TEST_MIGRATIONS: await readD1Migrations("./migrations"),
				},
			},
			wrangler: {
				configPath: "./dist/webdrop/wrangler.json",
			},
		})),
	],
	test: {
		deps: {
			optimizer: {
				ssr: {
					enabled: true,
					include: ["@opentelemetry/semantic-conventions"],
				},
			},
		},
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/apply-migrations.ts"],
	},
});
