import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { cleanupSites, handlePages, publishSite } from "../src/worker";

const controlOrigin = "https://webdrop.example.test";
const sitesOrigin = "https://sites.webdrop.example.test";

interface PublishResult {
	siteId: string;
	url: string;
	expiresAt: string;
}

interface FilePart {
	field: string;
	path: string;
}

interface UploadEntry {
	path: string;
	content: BlobPart;
}

interface RecordedPut {
	key: string;
	value: string | Blob;
}

function isPublishResult(value: unknown): value is PublishResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"siteId" in value &&
		"url" in value &&
		"expiresAt" in value &&
		typeof value.siteId === "string" &&
		typeof value.url === "string" &&
		typeof value.expiresAt === "string"
	);
}

function publishForm(entries: UploadEntry[], ttl?: string): FormData {
	const formData = new FormData();
	const parts: FilePart[] = entries.map(({ path }, index) => ({
		field: `file-${index}`,
		path,
	}));
	formData.set("files", JSON.stringify(parts));
	if (ttl !== undefined) {
		formData.set("ttl", ttl);
	}

	for (const [index, entry] of entries.entries()) {
		formData.set(
			`file-${index}`,
			new File([entry.content], entry.path.split("/").at(-1) ?? "file"),
		);
	}

	return formData;
}

async function publish(entries: UploadEntry[]): Promise<Response> {
	return exports.default.fetch(`${controlOrigin}/publish`, {
		method: "POST",
		headers: { Origin: controlOrigin },
		body: publishForm(entries),
	});
}

async function fragmentPublish(entries: UploadEntry[]): Promise<Response> {
	return exports.default.fetch(`${controlOrigin}/publish`, {
		method: "POST",
		headers: {
			"X-Webdrop-Fragment": "publish",
			Origin: controlOrigin,
		},
		body: publishForm(entries),
	});
}

function publishRequest(entries: UploadEntry[]): Request {
	return new Request(`${controlOrigin}/publish`, {
		method: "POST",
		body: publishForm(entries),
	});
}

async function publishCompletedSite(
	entries: UploadEntry[],
): Promise<PublishResult> {
	const response = await publish(entries);
	expect(response.status).toBe(201);
	const result: unknown = await response.json();
	if (!isPublishResult(result)) {
		throw new Error("Expected a publish result");
	}

	return result;
}

async function pageFetch(path: string, init?: RequestInit): Promise<Response> {
	return exports.default.fetch(`${sitesOrigin}${path}`, init);
}

async function storedObjectCount(): Promise<number> {
	return (await env.SITES.list()).objects.length;
}

function recordingStorage({ failFilePut = false } = {}): {
	headCalls: string[];
	puts: RecordedPut[];
	head(key: string): Promise<unknown>;
	put(
		key: string,
		value: string | Blob,
		options?: { httpMetadata: { contentType: string } },
	): Promise<unknown>;
} {
	const headCalls: string[] = [];
	const puts: RecordedPut[] = [];
	return {
		headCalls,
		puts,
		async head(key) {
			headCalls.push(key);
			return env.SITES.head(key);
		},
		async put(key, value, options) {
			puts.push({ key, value });
			if (failFilePut && key.startsWith("sites/")) {
				throw new Error("storage failure should not be logged verbatim");
			}

			return env.SITES.put(key, value, options);
		},
	};
}

function parseJson(value: string): unknown {
	return JSON.parse(value);
}

function storedMetadata(
	status: "active" | "uploading",
	createdAt: string,
	expiresAt: string,
): string {
	return JSON.stringify({
		status,
		createdAt,
		expiresAt,
		fileCount: 1,
		totalBytes: 7,
	});
}

function memoryCleanupStorage(
	initialEntries: Iterable<readonly [string, string]>,
	{ failMetadataDeleteOnce = false } = {},
) {
	const entries = new Map(initialEntries);
	const deleteBatches: string[][] = [];
	let shouldFailMetadataDelete = failMetadataDeleteOnce;

	return {
		entries,
		deleteBatches,
		async list({ prefix, limit }: { prefix: string; limit: number }) {
			const keys = [...entries.keys()]
				.filter((key) => key.startsWith(prefix))
				.sort();
			return {
				objects: keys.slice(0, limit).map((key) => ({ key })),
				truncated: keys.length > limit,
			};
		},
		async get(key: string) {
			const value = entries.get(key);
			if (value === undefined) {
				return null;
			}

			return {
				size: new TextEncoder().encode(value).byteLength,
				async text() {
					return value;
				},
			};
		},
		async delete(keys: string | string[]) {
			const batch = typeof keys === "string" ? [keys] : keys;
			deleteBatches.push(batch);
			if (
				shouldFailMetadataDelete &&
				batch.length === 1 &&
				batch[0]?.startsWith("_meta/")
			) {
				shouldFailMetadataDelete = false;
				throw new Error("simulated metadata delete failure");
			}

			for (const key of batch) {
				entries.delete(key);
			}
		},
	};
}

function closingBrace(css: string, openingBraceIndex: number): number {
	let depth = 0;
	for (let index = openingBraceIndex; index < css.length; index += 1) {
		const character = css[index];
		if (character === "{") {
			depth += 1;
		} else if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
}

function cssRule(
	css: string,
	selector: string,
): { start: number; body: string } | null {
	const start = css.indexOf(`${selector}{`);
	if (start === -1) {
		return null;
	}

	const openingBraceIndex = start + selector.length;
	const closingBraceIndex = closingBrace(css, openingBraceIndex);
	if (closingBraceIndex === -1) {
		return null;
	}

	return {
		start,
		body: css.slice(openingBraceIndex + 1, closingBraceIndex),
	};
}

describe("Webdrop M1.1 host dispatch", () => {
	it("serves the control document only from the control origin root", async () => {
		const response = await exports.default.fetch(`${controlOrigin}/`);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		const document = await response.text();
		expect(document).toContain("Put your site online.");
		expect(document).toContain("Drop an HTML file or folder");
		expect(document).toContain("Upload limits");
		expect(document).toContain('for="site-file"><span>Choose HTML file</span>');
		expect(document).toContain('for="site-folder"><span>Choose folder</span>');
		expect(document).toContain(
			'id="publish-submit" class="btn btn-primary publish-submit" type="submit"><span>Publish</span>',
		);
		expect(document).not.toContain("Publish site</span>");
		expect(document).toContain('accept=".html,.htm,text/html"');
		expect(document).toContain('class="brand-mark"');
		expect(document).toContain('src="/assets/logo.png"');
		expect(document).toContain('src="/assets/app.js"');
		expect(document).toContain("webkitdirectory");
		expect(document).toContain("publish-client-validation");
		expect(document).toContain('method="post" action="/publish"');
		const selectionStart = document.indexOf('<div class="publish-selection">');
		const expiryStart = document.indexOf('<div class="publish-expiry">');
		expect(selectionStart).toBeGreaterThan(-1);
		expect(expiryStart).toBeGreaterThan(selectionStart);
		expect(document).toContain('for="publish-ttl">Expires in</label>');
		expect(document).toContain('name="ttl"');
		expect(document).toContain(
			'<option value="86400" selected>24 hours</option>',
		);
		const formStart = document.indexOf('<form id="publish-form"');
		const resultStart = document.indexOf('<section id="publish-result"');
		const formEnd = document.indexOf("</form>", formStart);
		expect(resultStart).toBeGreaterThan(formStart);
		expect(resultStart).toBeLessThan(formEnd);
	});

	it("returns 404 for cross-plane and unknown routes", async () => {
		const [
			controlContentRoute,
			pagesControlRoute,
			unknownHost,
			unknownPagesRoute,
		] = await Promise.all([
			exports.default.fetch(`${controlOrigin}/p/demo/`),
			exports.default.fetch(`${sitesOrigin}/`),
			exports.default.fetch("https://unknown.example.test/"),
			pageFetch("/not-a-page"),
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

	it("serves generated UI assets and the logo from the control origin", async () => {
		const [app, styles, logo, pagesLogo] = await Promise.all([
			exports.default.fetch(`${controlOrigin}/assets/app.js`),
			exports.default.fetch(`${controlOrigin}/assets/app.css`),
			exports.default.fetch(`${controlOrigin}/assets/logo.png`),
			pageFetch("/assets/logo.png"),
		]);

		for (const response of [app, styles, logo]) {
			expect(response.status).toBe(200);
		}
		expect(logo.headers.get("Content-Type")).toBe("image/png");
		expect(pagesLogo.status).toBe(404);
		const appSource = await app.text();
		expect(appSource).toContain("X-Webdrop-Fragment");
		expect(appSource).not.toMatch(/\beval\s*\(/);
		const css = await styles.text();
		for (const componentClass of [
			"alert",
			"alert-error",
			"btn",
			"btn-primary",
			"card",
			"card-body",
			"card-title",
			"file-input",
			"progress",
			"progress-primary",
		]) {
			expect(css).toContain(`.${componentClass}`);
		}

		const utilitiesLayerStart = css.indexOf("@layer utilities{");
		const utilitiesLayerEnd = closingBrace(css, utilitiesLayerStart);
		expect(utilitiesLayerStart).toBeGreaterThan(-1);
		expect(utilitiesLayerEnd).toBeGreaterThan(utilitiesLayerStart);

		for (const [selector, declaration] of [
			[
				".publish-submit,.publish-selection,.publish-progress,.publish-expiry",
				"display:none",
			],
			[
				".publish-form:not([data-publish-state]) .publish-picker,.publish-form[data-publish-state=invalid] .publish-picker",
				"display:inline-flex",
			],
			[
				".publish-form[data-publish-state=ready] .publish-picker,.publish-form[data-publish-state=ready] .publish-progress",
				"display:none",
			],
			[
				".publish-form[data-publish-state=ready] .publish-submit,.publish-form[data-publish-state=ready] .publish-expiry",
				"display:inline-flex",
			],
			[
				".publish-form[data-publish-state=ready] .publish-selection,.publish-form[data-publish-state=invalid] .publish-selection",
				"display:block",
			],
			[
				".publish-form[data-publish-state=uploading] .publish-picker,.publish-form[data-publish-state=uploading] .publish-submit,.publish-form[data-publish-state=uploading] .publish-selection",
				"display:none",
			],
			[
				".publish-form[data-publish-state=uploading] .publish-progress",
				"display:grid",
			],
			[
				"#site-file:focus-visible~.publish-picker-actions .publish-file-picker,#site-folder:focus-visible~.publish-picker-actions .publish-folder-picker",
				"outline:3px solid #0066ff47",
			],
		] as const) {
			const rule = cssRule(css, selector);
			expect(rule).not.toBeNull();
			if (!rule) {
				throw new Error(`Missing CSS rule for ${selector}`);
			}
			expect(rule.start).toBeGreaterThan(utilitiesLayerEnd);
			expect(rule.body).toContain(declaration);
		}
	});
});

describe("Webdrop M2.1 publish boundary", () => {
	it("renders success and failure fragments for the publish target", async () => {
		const success = await fragmentPublish([
			{ path: "index.html", content: "<h1>Webdrop</h1>" },
		]);
		expect(success.status).toBe(201);
		expect(success.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(success.headers.get("X-Webdrop-Target")).toBe("publish-form");
		const successFragment = await success.text();
		expect(successFragment).toContain('class="publish-complete"');
		expect(successFragment).toContain(
			'aria-labelledby="publish-complete-title"',
		);
		expect(successFragment).toContain('aria-live="polite"');
		expect(successFragment).toContain('aria-atomic="true"');
		expect(successFragment).toContain('role="status"');
		expect(successFragment).toContain(
			'<h2 id="publish-complete-title">Site published.</h2>',
		);
		expect(successFragment).toContain("Live until");
		expect(successFragment).toContain("<time datetime=");
		expect(successFragment).toContain(
			'<a class="btn btn-primary publish-complete-link" href="https://sites.webdrop.example.test/p/',
		);
		expect(successFragment).toContain("<span>Open published site</span>");
		expect(successFragment).not.toContain('class="alert');
		expect(successFragment).not.toContain('id="publish-result"');

		const failure = await fragmentPublish([
			{ path: "missing-index.html", content: "invalid" },
		]);
		expect(failure.status).toBe(400);
		expect(await failure.text()).toContain('role="alert"');
	});

	it("rejects cross-origin publish requests before storage writes", async () => {
		const objectCountBefore = await storedObjectCount();
		const response = await exports.default.fetch(`${controlOrigin}/publish`, {
			method: "POST",
			headers: {
				"X-Webdrop-Fragment": "publish",
				Origin: "https://other.example.test",
			},
			body: publishForm([{ path: "index.html", content: "blocked" }]),
		});

		expect(response.status).toBe(403);
		expect(await response.text()).toContain('role="alert"');
		expect(await storedObjectCount()).toBe(objectCountBefore);
	});

	it("writes uploading metadata, files, then active metadata in order", async () => {
		const siteId = "00000000-0000-4000-8000-000000000003";
		const storage = recordingStorage();

		const response = await publishSite(
			publishRequest([
				{ path: "index.html", content: "ordered" },
				{ path: "assets/site.css", content: "body {}" },
			]),
			storage,
			"sites.webdrop.example.test",
			() => siteId,
			() => Date.parse("2026-08-05T00:00:00.000Z"),
		);

		expect(response.status).toBe(201);
		expect(storage.puts.map(({ key }) => key)).toEqual([
			`_meta/${siteId}.json`,
			`sites/${siteId}/index.html`,
			`sites/${siteId}/assets/site.css`,
			`_meta/${siteId}.json`,
		]);
		const metadataWrites = storage.puts
			.filter(({ key }) => key === `_meta/${siteId}.json`)
			.map(({ value }) =>
				typeof value === "string" ? parseJson(value) : null,
			);
		expect(metadataWrites).toEqual([
			expect.objectContaining({
				status: "uploading",
				createdAt: "2026-08-05T00:00:00.000Z",
				expiresAt: "2026-08-06T00:00:00.000Z",
				fileCount: 2,
				totalBytes: 14,
			}),
			expect.objectContaining({
				status: "active",
				expiresAt: "2026-08-06T00:00:00.000Z",
				fileCount: 2,
				totalBytes: 14,
			}),
		]);
	});

	it.each([
		["3600", "2026-08-05T01:00:00.000Z"],
		["86400", "2026-08-06T00:00:00.000Z"],
		["604800", "2026-08-12T00:00:00.000Z"],
	])("stores approved TTL %s as UTC expiresAt", async (ttl, expiresAt) => {
		const response = await publishSite(
			new Request(`${controlOrigin}/publish`, {
				method: "POST",
				body: publishForm([{ path: "index.html", content: "ttl" }], ttl),
			}),
			recordingStorage(),
			"sites.webdrop.example.test",
			() => crypto.randomUUID(),
			() => Date.parse("2026-08-05T00:00:00.000Z"),
		);

		expect(response.status).toBe(201);
		const result: unknown = await response.json();
		expect(result).toMatchObject({ expiresAt });
	});

	it.each([
		"0",
		"7200",
		"86400.5",
		" 86400 ",
		"8.64e4",
		"+86400",
		"not-a-duration",
	])("rejects unapproved TTL %s before storage writes", async (ttl) => {
		const storage = recordingStorage();
		const response = await publishSite(
			new Request(`${controlOrigin}/publish`, {
				method: "POST",
				body: publishForm([{ path: "index.html", content: "ttl" }], ttl),
			}),
			storage,
			"sites.webdrop.example.test",
		);

		expect(response.status).toBe(400);
		expect(storage.headCalls).toEqual([]);
		expect(storage.puts).toEqual([]);
	});

	it("uses the request scheme and port for local sites URLs", async () => {
		const siteId = "00000000-0000-4000-8000-000000000006";
		const response = await publishSite(
			new Request("https://control.localhost:8787/publish", {
				method: "POST",
				body: publishForm([{ path: "index.html", content: "local" }]),
			}),
			recordingStorage(),
			"sites.localhost",
			() => siteId,
		);

		expect(response.status).toBe(201);
		const result: unknown = await response.json();
		if (!isPublishResult(result)) {
			throw new Error("Expected a publish result");
		}
		expect(result.url).toBe(`https://sites.localhost:8787/p/${siteId}/`);
	});

	it("keeps failed uploads hidden and does not return a publish URL", async () => {
		const siteId = "00000000-0000-4000-8000-000000000004";
		const storage = recordingStorage({ failFilePut: true });

		const response = await publishSite(
			publishRequest([{ path: "index.html", content: "not active" }]),
			storage,
			"sites.webdrop.example.test",
			() => siteId,
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe("Unable to publish site");
		expect(storage.puts.map(({ key }) => key)).toEqual([
			`_meta/${siteId}.json`,
			`sites/${siteId}/index.html`,
		]);
		const metadata = await env.SITES.get(`_meta/${siteId}.json`);
		expect(metadata).not.toBeNull();
		if (!metadata) {
			throw new Error("Expected uploading metadata");
		}
		expect(await metadata.json<unknown>()).toMatchObject({
			status: "uploading",
		});
		expect((await pageFetch(`/p/${siteId}/`)).status).toBe(404);
	});

	it("rejects a generated site ID collision without overwriting the active site", async () => {
		const siteId = "00000000-0000-4000-8000-000000000005";
		await Promise.all([
			env.SITES.put(
				`_meta/${siteId}.json`,
				JSON.stringify({
					status: "active",
					createdAt: "2026-07-26T00:00:00.000Z",
					fileCount: 1,
					totalBytes: 8,
				}),
			),
			env.SITES.put(`sites/${siteId}/index.html`, "original"),
		]);
		const storage = recordingStorage();

		const response = await publishSite(
			publishRequest([{ path: "index.html", content: "replacement" }]),
			storage,
			"sites.webdrop.example.test",
			() => siteId,
		);

		expect(response.status).toBe(409);
		expect(storage.headCalls).toEqual([`_meta/${siteId}.json`]);
		expect(storage.puts).toEqual([]);
		const index = await env.SITES.get(`sites/${siteId}/index.html`);
		expect(index).not.toBeNull();
		if (!index) {
			throw new Error("Expected original site content");
		}
		expect(await index.text()).toBe("original");
	});

	it("publishes named multipart file parts only after a complete upload", async () => {
		const result = await publishCompletedSite([
			{ path: "index.html", content: "<h1>published</h1>" },
			{ path: "assets/site.css", content: "body { color: rebeccapurple; }" },
		]);

		expect(result.url).toBe(`${sitesOrigin}/p/${result.siteId}/`);
		const [metadataObject, indexObject, cssObject] = await Promise.all([
			env.SITES.get(`_meta/${result.siteId}.json`),
			env.SITES.get(`sites/${result.siteId}/index.html`),
			env.SITES.get(`sites/${result.siteId}/assets/site.css`),
		]);
		expect(metadataObject).not.toBeNull();
		expect(indexObject).not.toBeNull();
		expect(cssObject).not.toBeNull();
		if (!metadataObject || !indexObject || !cssObject) {
			throw new Error("Expected published R2 objects");
		}

		expect(await metadataObject.json<unknown>()).toMatchObject({
			status: "active",
			fileCount: 2,
			totalBytes: 48,
		});
		expect(await indexObject.text()).toBe("<h1>published</h1>");
		expect(await cssObject.text()).toBe("body { color: rebeccapurple; }");
	});

	it("serves only active sites with safe types and the pages security headers", async () => {
		const result = await publishCompletedSite([
			{ path: "index.html", content: "<h1>published</h1>" },
			{ path: "assets/site.css", content: "body { color: rebeccapurple; }" },
			{ path: "private.unknown", content: "not served" },
		]);

		const [indexResponse, cssResponse, unknownTypeResponse] = await Promise.all(
			[
				pageFetch(`/p/${result.siteId}/`),
				pageFetch(`/p/${result.siteId}/assets/site.css`),
				pageFetch(`/p/${result.siteId}/private.unknown`),
			],
		);

		expect(indexResponse.status).toBe(200);
		expect(indexResponse.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(indexResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(indexResponse.headers.get("Cache-Control")).toBe("no-store");
		expect(indexResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(indexResponse.headers.get("Permissions-Policy")).toBe(
			"camera=(), geolocation=(), microphone=()",
		);
		expect(indexResponse.headers.get("Content-Security-Policy")).toContain(
			"worker-src 'none'",
		);
		expect(await indexResponse.text()).toBe("<h1>published</h1>");
		expect(cssResponse.headers.get("Content-Type")).toBe(
			"text/css; charset=utf-8",
		);
		expect(await cssResponse.text()).toBe("body { color: rebeccapurple; }");
		expect(unknownTypeResponse.status).toBe(404);
	});

	it("returns the same 404 for missing, unknown, and incomplete sites", async () => {
		const incompleteSiteId = "00000000-0000-4000-8000-000000000001";
		await Promise.all([
			env.SITES.put(
				`_meta/${incompleteSiteId}.json`,
				JSON.stringify({
					status: "uploading",
					createdAt: "2026-07-26T00:00:00.000Z",
					fileCount: 1,
					totalBytes: 14,
				}),
			),
			env.SITES.put(`sites/${incompleteSiteId}/index.html`, "still hidden"),
		]);

		const [missing, unknown, incomplete] = await Promise.all([
			pageFetch("/p/00000000-0000-4000-8000-000000000002/"),
			pageFetch("/p/not-a-site/"),
			pageFetch(`/p/${incompleteSiteId}/`),
		]);

		for (const response of [missing, unknown, incomplete]) {
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("Not found");
		}
	});

	it("returns headers but no body for active-site HEAD requests", async () => {
		const result = await publishCompletedSite([
			{ path: "index.html", content: "head" },
		]);

		const response = await pageFetch(`/p/${result.siteId}/`, {
			method: "HEAD",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(await response.text()).toBe("");
	});

	it("serves before expiry and returns 404 at and after the exact boundary for GET and HEAD", async () => {
		const siteId = "00000000-0000-4000-8000-000000000007";
		const expiresAt = "2026-08-05T01:00:00.000Z";
		await Promise.all([
			env.SITES.put(
				`_meta/${siteId}.json`,
				JSON.stringify({
					status: "active",
					createdAt: "2026-08-05T00:00:00.000Z",
					expiresAt,
					fileCount: 1,
					totalBytes: 7,
				}),
			),
			env.SITES.put(`sites/${siteId}/index.html`, "expires"),
		]);
		const request = new Request(`${sitesOrigin}/p/${siteId}/`);
		const headRequest = new Request(request, { method: "HEAD" });

		const [getBefore, headBefore, getAt, headAfter] = await Promise.all([
			handlePages(request, env, () => Date.parse(expiresAt) - 1),
			handlePages(headRequest, env, () => Date.parse(expiresAt) - 1),
			handlePages(request, env, () => Date.parse(expiresAt)),
			handlePages(headRequest, env, () => Date.parse(expiresAt) + 1),
		]);

		expect(getBefore.status).toBe(200);
		expect(await getBefore.text()).toBe("expires");
		expect(headBefore.status).toBe(200);
		expect(await headBefore.text()).toBe("");
		expect(getAt.status).toBe(404);
		expect(headAfter.status).toBe(404);
	});

	it.each([
		["missing expiresAt", { status: "active" }],
		["invalid expiresAt", { status: "active", expiresAt: "tomorrow" }],
		[
			"invalid createdAt",
			{
				status: "active",
				createdAt: "yesterday",
				expiresAt: "2026-08-05T01:00:00.000Z",
			},
		],
		[
			"expiresAt before createdAt",
			{
				status: "active",
				createdAt: "2026-08-05T02:00:00.000Z",
				expiresAt: "2026-08-05T01:00:00.000Z",
			},
		],
		[
			"unapproved lifetime",
			{
				status: "active",
				expiresAt: "2026-08-06T00:00:00.001Z",
			},
		],
		[
			"non-canonical expiresAt",
			{ status: "active", expiresAt: "2026-08-05T01:00:00Z" },
		],
		[
			"unknown status",
			{ status: "ready", expiresAt: "2026-08-05T01:00:00.000Z" },
		],
	])("returns safe 404 for metadata with %s", async (_case, overrides) => {
		const siteId = crypto.randomUUID();
		await Promise.all([
			env.SITES.put(
				`_meta/${siteId}.json`,
				JSON.stringify({
					createdAt: "2026-08-05T00:00:00.000Z",
					fileCount: 1,
					totalBytes: 6,
					...overrides,
				}),
			),
			env.SITES.put(`sites/${siteId}/index.html`, "hidden"),
		]);

		const response = await handlePages(
			new Request(`${sitesOrigin}/p/${siteId}/`),
			env,
			() => Date.parse("2026-08-05T00:30:00.000Z"),
		);

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not found");
	});

	it("preserves pages method and service worker protections", async () => {
		const result = await publishCompletedSite([
			{ path: "index.html", content: "protected" },
		]);
		const [postResponse, fetchMetadataResponse, serviceWorkerHeaderResponse] =
			await Promise.all([
				pageFetch(`/p/${result.siteId}/`, { method: "POST" }),
				pageFetch(`/p/${result.siteId}/`, {
					headers: { "Sec-Fetch-Dest": "serviceworker" },
				}),
				pageFetch(`/p/${result.siteId}/`, {
					headers: { "Service-Worker": "script" },
				}),
			]);

		expect(postResponse.status).toBe(405);
		expect(postResponse.headers.get("Allow")).toBe("GET, HEAD");
		expect(postResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(fetchMetadataResponse.status).toBe(403);
		expect(serviceWorkerHeaderResponse.status).toBe(403);
	});

	it("rejects malformed file-part maps without writing an active site", async () => {
		const objectCountBefore = await storedObjectCount();
		const formData = new FormData();
		formData.set(
			"files",
			JSON.stringify([{ field: "file-0", path: "index.html" }]),
		);
		formData.set("file-0", "not a file");

		const response = await exports.default.fetch(`${controlOrigin}/publish`, {
			method: "POST",
			headers: { Origin: controlOrigin },
			body: formData,
		});

		expect(response.status).toBe(400);
		expect(await storedObjectCount()).toBe(objectCountBefore);
	});

	it.each([
		["an unlisted File", "attachment", new File(["extra"], "extra.txt")],
		["an unlisted file-* part", "file-extra", "extra"],
	])("rejects %s", async (_description, field, value) => {
		const objectCountBefore = await storedObjectCount();
		const formData = publishForm([{ path: "index.html", content: "valid" }]);
		formData.set(field, value);

		const response = await exports.default.fetch(`${controlOrigin}/publish`, {
			method: "POST",
			headers: { Origin: controlOrigin },
			body: formData,
		});

		expect(response.status).toBe(400);
		expect(await storedObjectCount()).toBe(objectCountBefore);
	});

	it.each([
		"/index.html",
		"assets/../index.html",
		"assets//index.html",
		"assets\\index.html",
		"assets/\u0000index.html",
		"_meta/index.html",
		"sites/index.html",
	])("rejects unsafe relative path %j", async (path) => {
		const objectCountBefore = await storedObjectCount();
		const response = await publish([{ path, content: "invalid" }]);

		expect(response.status).toBe(400);
		expect(await storedObjectCount()).toBe(objectCountBefore);
	});

	it("enforces index, unique-path, file-count, per-file, and total-size limits", async () => {
		const noIndex = await publish([
			{ path: "main.html", content: "missing index" },
		]);
		expect(noIndex.status).toBe(400);

		const duplicatePath = await publish([
			{ path: "index.html", content: "one" },
			{ path: "index.html", content: "two" },
		]);
		expect(duplicatePath.status).toBe(400);

		const tooManyFiles = await publish(
			Array.from({ length: 101 }, (_, index) => ({
				path: index === 0 ? "index.html" : `assets/${index}.txt`,
				content: "x",
			})),
		);
		expect(tooManyFiles.status).toBe(400);

		const tooLargeFile = await publish([
			{
				path: "index.html",
				content: new Uint8Array(10 * 1024 * 1024 + 1),
			},
		]);
		expect(tooLargeFile.status).toBe(400);

		const totalTooLarge = await publish(
			Array.from({ length: 6 }, (_, index) => ({
				path: index === 0 ? "index.html" : `assets/${index}.bin`,
				content: new Uint8Array(9 * 1024 * 1024),
			})),
		);
		expect(totalTooLarge.status).toBe(400);
	});
});

describe("Webdrop M3.2 scheduled cleanup", () => {
	const now = Date.parse("2026-08-05T12:00:00.000Z");

	it("deletes expired active and abandoned uploading sites while preserving live sites", async () => {
		const expiredId = "00000000-0000-4000-8000-000000000101";
		const abandonedId = "00000000-0000-4000-8000-000000000102";
		const activeId = "00000000-0000-4000-8000-000000000103";
		const uploadingId = "00000000-0000-4000-8000-000000000104";
		const storage = memoryCleanupStorage([
			[
				`_meta/${expiredId}.json`,
				storedMetadata(
					"active",
					"2026-08-05T10:00:00.000Z",
					"2026-08-05T11:00:00.000Z",
				),
			],
			[`sites/${expiredId}/index.html`, "expired secret"],
			[
				`_meta/${abandonedId}.json`,
				storedMetadata(
					"uploading",
					"2026-08-04T11:59:59.999Z",
					"2026-08-05T12:00:00.000Z",
				),
			],
			[`sites/${abandonedId}/partial.html`, "partial secret"],
			[
				`_meta/${activeId}.json`,
				storedMetadata(
					"active",
					"2026-08-05T11:00:00.000Z",
					"2026-08-05T13:00:00.000Z",
				),
			],
			[`sites/${activeId}/index.html`, "live"],
			[
				`_meta/${uploadingId}.json`,
				storedMetadata(
					"uploading",
					"2026-08-04T12:00:00.000Z",
					"2026-08-05T12:00:00.001Z",
				),
			],
			[`sites/${uploadingId}/partial.html`, "recent"],
		]);
		const logs: unknown[] = [];

		const result = await cleanupSites(
			storage,
			() => now,
			(entry) => logs.push(entry),
		);

		expect(result).toEqual({
			result: "completed",
			scannedSites: 4,
			deletedSites: 2,
			skippedSites: 0,
		});
		expect(storage.entries.has(`_meta/${expiredId}.json`)).toBe(false);
		expect(storage.entries.has(`sites/${expiredId}/index.html`)).toBe(false);
		expect(storage.entries.has(`_meta/${abandonedId}.json`)).toBe(false);
		expect(storage.entries.has(`sites/${abandonedId}/partial.html`)).toBe(
			false,
		);
		expect(storage.entries.has(`_meta/${activeId}.json`)).toBe(true);
		expect(storage.entries.has(`_meta/${uploadingId}.json`)).toBe(true);
		expect(logs).toEqual([
			{
				siteId: expiredId,
				reason: "expired",
				deletedObjects: 2,
				result: "deleted",
			},
			{
				siteId: abandonedId,
				reason: "abandoned_upload",
				deletedObjects: 2,
				result: "deleted",
			},
		]);
		expect(JSON.stringify(logs)).not.toContain("secret");
	});

	it("rechecks metadata immediately before deletion and skips a changed site", async () => {
		const siteId = "00000000-0000-4000-8000-000000000105";
		const key = `_meta/${siteId}.json`;
		const baseStorage = memoryCleanupStorage([
			[
				key,
				storedMetadata(
					"active",
					"2026-08-05T10:00:00.000Z",
					"2026-08-05T11:00:00.000Z",
				),
			],
			[`sites/${siteId}/index.html`, "preserved"],
		]);
		let metadataReads = 0;
		const storage = {
			list: baseStorage.list,
			delete: baseStorage.delete,
			async get(objectKey: string) {
				if (objectKey === key) {
					metadataReads += 1;
					if (metadataReads === 2) {
						baseStorage.entries.set(
							key,
							storedMetadata(
								"active",
								"2026-08-05T11:00:00.000Z",
								"2026-08-05T13:00:00.000Z",
							),
						);
					}
				}
				return baseStorage.get(objectKey);
			},
		};

		const result = await cleanupSites(
			storage,
			() => now,
			() => undefined,
		);

		expect(result).toMatchObject({ deletedSites: 0, skippedSites: 1 });
		expect(baseStorage.entries.has(key)).toBe(true);
		expect(baseStorage.entries.has(`sites/${siteId}/index.html`)).toBe(true);
	});

	it("treats metadata that disappears before deletion as an idempotent success", async () => {
		const siteId = "00000000-0000-4000-8000-000000000108";
		const key = `_meta/${siteId}.json`;
		const baseStorage = memoryCleanupStorage([
			[
				key,
				storedMetadata(
					"active",
					"2026-08-05T10:00:00.000Z",
					"2026-08-05T11:00:00.000Z",
				),
			],
		]);
		let metadataReads = 0;
		const logs: unknown[] = [];
		const storage = {
			list: baseStorage.list,
			delete: baseStorage.delete,
			async get(objectKey: string) {
				if (objectKey === key) {
					metadataReads += 1;
					if (metadataReads === 2) {
						baseStorage.entries.delete(key);
					}
				}
				return baseStorage.get(objectKey);
			},
		};

		const result = await cleanupSites(
			storage,
			() => now,
			(entry) => logs.push(entry),
		);

		expect(result).toMatchObject({ deletedSites: 0, skippedSites: 1 });
		expect(logs).toEqual([
			{
				siteId,
				reason: "expired",
				deletedObjects: 0,
				result: "already_absent",
			},
		]);
	});

	it("stops without deleting when the metadata scan exceeds 1000 sites", async () => {
		const deleteCalls: unknown[] = [];
		const logs: unknown[] = [];
		const storage = {
			async list() {
				return {
					objects: Array.from({ length: 1000 }, (_, index) => ({
						key: `_meta/${index}.json`,
					})),
					truncated: true,
				};
			},
			async get() {
				throw new Error("metadata must not be read above the scan limit");
			},
			async delete(keys: string | string[]) {
				deleteCalls.push(keys);
			},
		};

		const result = await cleanupSites(
			storage,
			() => now,
			(entry) => logs.push(entry),
		);

		expect(result).toEqual({
			result: "scan_limit_exceeded",
			scannedSites: 1000,
			deletedSites: 0,
			skippedSites: 0,
		});
		expect(deleteCalls).toEqual([]);
		expect(logs).toEqual([
			{
				reason: "scan_limit_exceeded",
				deletedObjects: 0,
				result: "warning",
			},
		]);
	});

	it("deletes site objects in batches of at most 1000 and safely resumes after interruption", async () => {
		const siteId = "00000000-0000-4000-8000-000000000106";
		const metadataKey = `_meta/${siteId}.json`;
		const storage = memoryCleanupStorage(
			[
				[
					metadataKey,
					storedMetadata(
						"active",
						"2026-08-05T10:00:00.000Z",
						"2026-08-05T11:00:00.000Z",
					),
				],
				...Array.from(
					{ length: 1001 },
					(_, index) =>
						[
							`sites/${siteId}/${index.toString().padStart(4, "0")}.txt`,
							"content",
						] as const,
				),
			],
			{ failMetadataDeleteOnce: true },
		);
		const logs: unknown[] = [];

		await expect(
			cleanupSites(
				storage,
				() => now,
				(entry) => logs.push(entry),
			),
		).rejects.toThrow("simulated metadata delete failure");
		expect(storage.entries.has(metadataKey)).toBe(true);
		expect(
			[...storage.entries.keys()].filter((key) =>
				key.startsWith(`sites/${siteId}/`),
			),
		).toEqual([]);
		expect(logs).toEqual([
			{
				siteId,
				reason: "expired",
				deletedObjects: 1001,
				result: "failed",
			},
		]);

		const retry = await cleanupSites(
			storage,
			() => now,
			() => undefined,
		);

		expect(retry).toMatchObject({ deletedSites: 1, skippedSites: 0 });
		expect(storage.entries.size).toBe(0);
		expect(storage.deleteBatches.map((batch) => batch.length)).toEqual([
			1000, 1, 1, 1,
		]);
	});

	it("runs cleanup from the scheduled handler using the scheduled time", async () => {
		const siteId = "00000000-0000-4000-8000-000000000107";
		await Promise.all([
			env.SITES.put(
				`_meta/${siteId}.json`,
				storedMetadata(
					"active",
					"2026-08-05T10:00:00.000Z",
					"2026-08-05T11:00:00.000Z",
				),
			),
			env.SITES.put(`sites/${siteId}/index.html`, "scheduled"),
		]);

		await worker.scheduled({ scheduledTime: now } as ScheduledController, env);

		expect(await env.SITES.get(`_meta/${siteId}.json`)).toBeNull();
		expect(await env.SITES.get(`sites/${siteId}/index.html`)).toBeNull();
	});
});
