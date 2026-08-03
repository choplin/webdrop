import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: "./dist/webdrop/wrangler.json",
			},
		}),
	],
	test: {
		include: ["test/**/*.test.ts"],
	},
});
