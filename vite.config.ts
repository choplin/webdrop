import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
	build: {
		assetsInlineLimit: 0,
		cssCodeSplit: false,
		rollupOptions: {
			input: "client/index.html",
			output: {
				assetFileNames: (assetInfo) =>
					assetInfo.names.some((name) => name.endsWith(".css"))
						? "assets/app.css"
						: "assets/[name][extname]",
				chunkFileNames: "assets/[name]-[hash].js",
				entryFileNames: (chunkInfo) =>
					chunkInfo.moduleIds.some((id) => id.endsWith("/client/app.ts"))
						? "assets/app.js"
						: "assets/[name].js",
			},
		},
	},
	plugins: [
		{
			name: "preserve-http2-authority",
			enforce: "pre",
			configureServer(server) {
				server.middlewares.use((request, _response, next) => {
					const authority = request.headers[":authority"];

					if (!request.headers.host && typeof authority === "string") {
						request.headers.host = authority;
						request.rawHeaders.push("host", authority);
					}

					next();
				});
			},
		},
		basicSsl({
			domains: ["localhost", "pages.localhost"],
		}),
		tailwindcss(),
		cloudflare(
			command === "serve"
				? {
						config: {
							vars: {
								CONTROL_HOSTNAME: "localhost",
								PAGES_HOSTNAME: "pages.localhost",
							},
						},
					}
				: undefined,
		),
	],
	preview: {
		port: 8787,
		strictPort: true,
	},
	publicDir: false,
	server: {
		port: 8787,
		strictPort: true,
	},
}));
