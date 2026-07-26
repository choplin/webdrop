import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const controlOrigin = "https://control.example.test";
const pagesOrigin = "https://pages.example.test";
const fixedContentPath = "/p/demo/";

async function workerFetch(
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return exports.default.fetch(`${pagesOrigin}${path}`, init);
}

describe("Webdrop M1.1 host dispatch", () => {
	it("serves fixed control HTML only from the control origin root", async () => {
		const response = await exports.default.fetch(`${controlOrigin}/`);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(await response.text()).toContain("Webdrop control");
	});

	it("returns 404 for cross-plane and unknown routes", async () => {
		const [
			controlContentRoute,
			pagesControlRoute,
			unknownHost,
			unknownPagesRoute,
		] = await Promise.all([
			exports.default.fetch(`${controlOrigin}${fixedContentPath}`),
			exports.default.fetch(`${pagesOrigin}/`),
			exports.default.fetch("https://unknown.example.test/"),
			workerFetch("/not-a-page"),
		]);

		for (const response of [
			controlContentRoute,
			pagesControlRoute,
			unknownHost,
			unknownPagesRoute,
		]) {
			expect(response.status).toBe(404);
		}
	});

	it("serves fixed pages content with the required security headers", async () => {
		const response = await workerFetch(fixedContentPath);

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(response.headers.get("Permissions-Policy")).toBe(
			"camera=(), geolocation=(), microphone=()",
		);
		expect(response.headers.get("Content-Security-Policy")).toContain(
			"worker-src 'none'",
		);
		expect(await response.text()).toContain("Webdrop fixed content");
	});

	it("returns headers but no body for HEAD", async () => {
		const response = await workerFetch(fixedContentPath, { method: "HEAD" });

		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(await response.text()).toBe("");
	});

	it("rejects unsupported pages methods", async () => {
		const response = await workerFetch(fixedContentPath, { method: "POST" });

		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("GET, HEAD");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("rejects service worker script requests by Fetch Metadata or Service-Worker header", async () => {
		const [fetchMetadataResponse, serviceWorkerHeaderResponse] =
			await Promise.all([
				workerFetch(fixedContentPath, {
					headers: { "Sec-Fetch-Dest": "serviceworker" },
				}),
				workerFetch(fixedContentPath, {
					headers: { "Service-Worker": "script" },
				}),
			]);

		expect(fetchMetadataResponse.status).toBe(403);
		expect(serviceWorkerHeaderResponse.status).toBe(403);
	});
});
