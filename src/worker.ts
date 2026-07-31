const controlDocument = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Webdrop</title>
	<link rel="stylesheet" href="/assets/app.css">
	<script src="/assets/htmx.min.js" defer></script>
	<script type="module" src="/assets/publish-adapter.js"></script>
</head>
<body class="control-page">
	<div class="control-layout">
		<header class="control-nav" aria-label="Webdrop">
			<div class="control-brand">
				<img class="brand-mark" src="/assets/logo.png" alt="">
				<span class="brand-wordmark">webdrop</span>
			</div>
		</header>
		<main class="publish-main">
			<section class="publish-focus" aria-labelledby="publish-page-title">
				<header class="publish-introduction">
					<h1 id="publish-page-title">Put your site online.</h1>
					<p>Choose a folder with <code>index.html</code>. Get a shareable URL when every file is published.</p>
				</header>
				<section class="card publish-card" aria-labelledby="publish-heading">
					<div class="card-body publish-card-body">
						<form id="publish-form" class="publish-form" method="post" action="/publish" enctype="multipart/form-data" hx-post="/publish" hx-target="#publish-result" hx-swap="outerHTML" hx-encoding="multipart/form-data" hx-disabled-elt="#publish-submit">
							<input id="site-files" class="file-input publish-file-input" type="file" name="site-files" webkitdirectory multiple aria-required="true" aria-describedby="site-files-help selection-summary publish-client-validation">
							<div class="publish-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z" /><path d="M12 16V10m-2.5 2.5L12 10l2.5 2.5" /></svg></div>
							<div class="publish-copy">
								<h2 id="publish-heading" class="card-title">Drop a folder to publish</h2>
								<p id="site-files-help" class="field-help">Its root must contain <code>index.html</code>.</p>
							</div>
							<div class="publish-picker-actions">
								<label class="btn btn-primary publish-picker" for="site-files"><span>Choose directory</span><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg></label>
								<button id="publish-submit" class="btn btn-primary publish-submit" type="submit"><span>Publish site</span><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg></button>
							</div>
							<div class="publish-selection">
								<p id="selection-summary" class="field-help" aria-live="polite">No directory selected.</p>
								<p id="publish-client-validation" class="alert alert-error" role="alert" hidden></p>
							</div>
							<div class="publish-progress" aria-live="polite">
								<label class="field-label" for="publish-progress">Upload progress</label>
								<progress id="publish-progress" class="progress progress-primary" value="0" max="100">0%</progress>
								<p id="publish-progress-status" class="field-help">Waiting to upload.</p>
							</div>
						</form>
					</div>
				</section>
				<div class="publish-metadata">
					<p class="publish-safety"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>Files stay private until publishing is complete.</p>
					<ul class="publish-limit-list" aria-label="Publish limits"><li>100 files</li><li>10 MiB / file</li><li>50 MiB total</li></ul>
				</div>
				<section id="publish-result" class="publish-result" aria-live="polite" aria-atomic="true"></section>
			</section>
		</main>
	</div>
</body>
</html>`;

const maxFiles = 100;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 50 * 1024 * 1024;
const maxMetadataBytes = 2048;
const pagesPrefix = "/p/";
const metadataPrefix = "_meta/";
const sitesPrefix = "sites/";

const pagesHeaders = {
	"Cache-Control": "no-store",
	"Content-Security-Policy":
		"base-uri 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'",
	"Permissions-Policy": "camera=(), geolocation=(), microphone=()",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
} as const;

const controlHtmlHeaders = {
	"Content-Type": "text/html; charset=utf-8",
} as const;

const contentTypes = new Map<string, string>([
	["avif", "image/avif"],
	["css", "text/css; charset=utf-8"],
	["gif", "image/gif"],
	["htm", "text/html; charset=utf-8"],
	["html", "text/html; charset=utf-8"],
	["ico", "image/x-icon"],
	["jpeg", "image/jpeg"],
	["jpg", "image/jpeg"],
	["js", "text/javascript; charset=utf-8"],
	["json", "application/json; charset=utf-8"],
	["map", "application/json; charset=utf-8"],
	["mjs", "text/javascript; charset=utf-8"],
	["pdf", "application/pdf"],
	["png", "image/png"],
	["svg", "image/svg+xml"],
	["txt", "text/plain; charset=utf-8"],
	["wasm", "application/wasm"],
	["webmanifest", "application/manifest+json"],
	["webp", "image/webp"],
	["woff", "font/woff"],
	["woff2", "font/woff2"],
	["xml", "application/xml; charset=utf-8"],
]);

type SiteStatus = "uploading" | "active";

interface SiteMetadata {
	status: SiteStatus;
	createdAt: string;
	fileCount: number;
	totalBytes: number;
}

interface PublishPayload {
	files: PublishedFile[];
	totalBytes: number;
}

interface PublishedFile {
	path: string;
	file: File;
}

/** A `files` JSON entry explicitly pairs one multipart field with one relative path. */
interface PublishFilePart {
	field: string;
	path: string;
}

interface PublishStorage {
	head(key: string): Promise<unknown>;
	put(
		key: string,
		value: string | Blob,
		options?: { httpMetadata: { contentType: string } },
	): Promise<unknown>;
}

interface PublishedSite {
	siteId: string;
	url: string;
}

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

function pagesNotFound(): Response {
	return new Response("Not found", { status: 404, headers: pagesHeaders });
}

function badRequest(message: string): Response {
	return new Response(message, { status: 400 });
}

function conflict(): Response {
	return new Response("Site already exists", { status: 409 });
}

function internalError(): Response {
	return new Response("Unable to publish site", { status: 500 });
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			"'": "&#39;",
			'"': "&quot;",
		};
		return entities[character] ?? character;
	});
}

function publishErrorFragment(message: string, status: number): Response {
	return new Response(
		`<section id="publish-result" class="publish-result" aria-live="polite" aria-atomic="true"><div class="alert alert-error" role="alert"><span>${escapeHtml(message)}</span></div></section>`,
		{ status, headers: controlHtmlHeaders },
	);
}

function publishSuccessFragment(url: string): Response {
	const safeUrl = escapeHtml(url);
	return new Response(
		`<section id="publish-result" class="publish-result" aria-live="polite" aria-atomic="true"><div class="alert alert-success" role="status"><span>Site is live.</span><a class="link" href="${safeUrl}">Open published site</a></div></section>`,
		{ status: 201, headers: controlHtmlHeaders },
	);
}

function pagesMethodNotAllowed(): Response {
	return new Response(null, {
		status: 405,
		headers: {
			...pagesHeaders,
			Allow: "GET, HEAD",
		},
	});
}

function serviceWorkerRequest(request: Request): boolean {
	return (
		request.headers.get("Sec-Fetch-Dest") === "serviceworker" ||
		request.headers.get("Service-Worker") === "script"
	);
}

function metadataKey(siteId: string): string {
	return `${metadataPrefix}${siteId}.json`;
}

function siteFileKey(siteId: string, relativePath: string): string {
	return `${sitesPrefix}${siteId}/${relativePath}`;
}

function contentTypeForPath(relativePath: string): string | null {
	const extension = relativePath.split(".").at(-1)?.toLowerCase();
	return extension ? (contentTypes.get(extension) ?? null) : null;
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true;
		}
	}

	return false;
}

function isSafeRelativePath(relativePath: string): boolean {
	if (
		relativePath.length === 0 ||
		relativePath.startsWith("/") ||
		relativePath.includes("\\") ||
		hasControlCharacter(relativePath)
	) {
		return false;
	}

	const segments = relativePath.split("/");
	if (
		segments.some(
			(segment) => segment.length === 0 || segment === "." || segment === "..",
		)
	) {
		return false;
	}

	return !(
		relativePath === "_meta" ||
		relativePath.startsWith(metadataPrefix) ||
		relativePath === "sites" ||
		relativePath.startsWith(sitesPrefix)
	);
}

function parseFileParts(
	value: FormDataEntryValue | null,
): PublishFilePart[] | null {
	if (typeof value !== "string") {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(value);
		if (
			!Array.isArray(parsed) ||
			!parsed.every(
				(part) =>
					typeof part === "object" &&
					part !== null &&
					"field" in part &&
					"path" in part &&
					typeof part.field === "string" &&
					typeof part.path === "string",
			)
		) {
			return null;
		}

		return parsed;
	} catch {
		return null;
	}
}

function parsePublishPayload(formData: FormData): PublishPayload | Response {
	const partEntries = formData.getAll("files");
	const parts = parseFileParts(
		partEntries.length === 1 ? (partEntries[0] ?? null) : null,
	);
	if (parts === null) {
		return badRequest("files must describe each multipart file part");
	}

	if (parts.length === 0 || parts.length > maxFiles) {
		return badRequest("A publish must contain between 1 and 100 files");
	}

	const partFields = new Set(parts.map(({ field }) => field));
	for (const [field, value] of formData.entries()) {
		if (
			(value instanceof File || field.startsWith("file-")) &&
			!partFields.has(field)
		) {
			return badRequest("Multipart file parts must be listed in files");
		}
	}

	const files: PublishedFile[] = [];
	let totalBytes = 0;
	for (const part of parts) {
		const entries = formData.getAll(part.field);
		const entry = entries.length === 1 ? entries[0] : null;
		if (
			!part.field.startsWith("file-") ||
			!isSafeRelativePath(part.path) ||
			!(entry instanceof File)
		) {
			return badRequest("Each file must have a safe relative path");
		}

		if (entry.size > maxFileBytes) {
			return badRequest("Each file must be 10 MiB or smaller");
		}

		totalBytes += entry.size;
		if (totalBytes > maxTotalBytes) {
			return badRequest("A publish must be 50 MiB or smaller");
		}

		files.push({ path: part.path, file: entry });
	}

	if (!files.some(({ path }) => path === "index.html")) {
		return badRequest("index.html is required");
	}

	if (
		new Set(files.map(({ path }) => path)).size !== files.length ||
		new Set(parts.map(({ field }) => field)).size !== parts.length
	) {
		return badRequest("File paths and multipart field names must be unique");
	}

	return { files, totalBytes };
}

function isResponse(value: PublishPayload | Response): value is Response {
	return value instanceof Response;
}

function isPublishedSite(value: unknown): value is PublishedSite {
	return (
		typeof value === "object" &&
		value !== null &&
		"siteId" in value &&
		"url" in value &&
		typeof value.siteId === "string" &&
		typeof value.url === "string"
	);
}

function isSiteMetadata(value: unknown): value is SiteMetadata {
	return (
		typeof value === "object" &&
		value !== null &&
		"status" in value &&
		"createdAt" in value &&
		"fileCount" in value &&
		"totalBytes" in value &&
		(value.status === "uploading" || value.status === "active") &&
		typeof value.createdAt === "string" &&
		typeof value.fileCount === "number" &&
		typeof value.totalBytes === "number"
	);
}

function parseMetadata(value: string): SiteMetadata | null {
	try {
		const parsed: unknown = JSON.parse(value);
		return isSiteMetadata(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function parsePageRequest(
	pathname: string,
): { siteId: string; relativePath: string } | null {
	if (!pathname.startsWith(pagesPrefix)) {
		return null;
	}

	const route = pathname.slice(pagesPrefix.length);
	const separatorIndex = route.indexOf("/");
	const encodedSiteId =
		separatorIndex === -1 ? route : route.slice(0, separatorIndex);
	const encodedPath =
		separatorIndex === -1 ? "" : route.slice(separatorIndex + 1);
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			encodedSiteId,
		)
	) {
		return null;
	}

	let relativePath: string;
	try {
		relativePath =
			encodedPath === "" ? "index.html" : decodeURIComponent(encodedPath);
	} catch {
		return null;
	}

	return isSafeRelativePath(relativePath)
		? { siteId: encodedSiteId, relativePath }
		: null;
}

async function readActiveMetadata(
	bucket: R2Bucket,
	siteId: string,
): Promise<SiteMetadata | null> {
	const metadataObject = await bucket.get(metadataKey(siteId));
	if (!metadataObject || metadataObject.size > maxMetadataBytes) {
		return null;
	}

	const metadata = parseMetadata(await metadataObject.text());
	return metadata?.status === "active" ? metadata : null;
}

export async function publishSite(
	request: Request,
	storage: PublishStorage,
	pagesHostname: string,
	createSiteId: () => string = () => crypto.randomUUID(),
): Promise<Response> {
	if (request.method !== "POST") {
		return notFound();
	}

	if (
		!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")
	) {
		return badRequest("Expected multipart/form-data");
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return badRequest("Invalid multipart form data");
	}

	const payload = parsePublishPayload(formData);
	if (isResponse(payload)) {
		return payload;
	}

	const siteId = createSiteId();
	const metadata: SiteMetadata = {
		status: "uploading",
		createdAt: new Date().toISOString(),
		fileCount: payload.files.length,
		totalBytes: payload.totalBytes,
	};

	if (await storage.head(metadataKey(siteId))) {
		return conflict();
	}

	try {
		await storage.put(metadataKey(siteId), JSON.stringify(metadata));
		for (const { path, file } of payload.files) {
			const contentType = contentTypeForPath(path);
			await storage.put(
				siteFileKey(siteId, path),
				file,
				contentType ? { httpMetadata: { contentType } } : undefined,
			);
		}

		await storage.put(
			metadataKey(siteId),
			JSON.stringify({ ...metadata, status: "active" satisfies SiteStatus }),
		);
	} catch {
		console.error(
			JSON.stringify({
				message: "site publish failed",
			}),
		);
		return internalError();
	}

	return Response.json(
		{
			siteId,
			url: publishedSiteUrl(request, pagesHostname, siteId),
		},
		{ status: 201 },
	);
}

function publishedSiteUrl(
	request: Request,
	pagesHostname: string,
	siteId: string,
): string {
	const requestUrl = new URL(request.url);
	const port = requestUrl.port === "" ? "" : `:${requestUrl.port}`;
	return `${requestUrl.protocol}//${pagesHostname}${port}${pagesPrefix}${siteId}/`;
}

function isSameOriginRequest(request: Request): boolean {
	const origin = request.headers.get("Origin");
	return origin !== null && origin === new URL(request.url).origin;
}

function isHtmxRequest(request: Request): boolean {
	return request.headers.get("HX-Request") === "true";
}

function publishFailureMessage(status: number): string {
	switch (status) {
		case 400:
			return "We could not use this directory. Check the file limits and paths.";
		case 409:
			return "This publish ID is unavailable. Please try again.";
		default:
			return "We could not publish this site. Please try again.";
	}
}

async function handleControlPublish(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isSameOriginRequest(request)) {
		return isHtmxRequest(request)
			? publishErrorFragment(
					"This publish request did not come from this site.",
					403,
				)
			: new Response("Forbidden", { status: 403 });
	}

	const response = await publishSite(request, env.SITES, env.PAGES_HOSTNAME);
	if (!isHtmxRequest(request)) {
		return response;
	}

	if (response.status !== 201) {
		return publishErrorFragment(
			publishFailureMessage(response.status),
			response.status,
		);
	}

	const publishedSite: unknown = await response.json();
	if (!isPublishedSite(publishedSite)) {
		return publishErrorFragment(
			"We could not publish this site. Please try again.",
			500,
		);
	}

	return publishSuccessFragment(publishedSite.url);
}

async function handleControl(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/publish") {
		return handleControlPublish(request, env);
	}

	if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
		return env.ASSETS.fetch(request);
	}

	if (request.method !== "GET" || url.pathname !== "/") {
		return notFound();
	}

	return new Response(controlDocument, { headers: controlHtmlHeaders });
}

async function handlePages(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const page = parsePageRequest(url.pathname);
	if (!page) {
		return pagesNotFound();
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		return pagesMethodNotAllowed();
	}

	if (serviceWorkerRequest(request)) {
		return new Response("Forbidden", { status: 403, headers: pagesHeaders });
	}

	if (!(await readActiveMetadata(env.SITES, page.siteId))) {
		return pagesNotFound();
	}

	const contentType = contentTypeForPath(page.relativePath);
	if (!contentType) {
		return pagesNotFound();
	}

	if (request.method === "HEAD") {
		const object = await env.SITES.head(
			siteFileKey(page.siteId, page.relativePath),
		);
		if (!object) {
			return pagesNotFound();
		}

		return new Response(null, {
			headers: { ...pagesHeaders, "Content-Type": contentType },
		});
	}

	const object = await env.SITES.get(
		siteFileKey(page.siteId, page.relativePath),
	);
	if (!object) {
		return pagesNotFound();
	}

	return new Response(object.body, {
		headers: { ...pagesHeaders, "Content-Type": contentType },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const hostname = new URL(request.url).hostname;

		if (hostname === env.CONTROL_HOSTNAME) {
			return handleControl(request, env);
		}

		if (hostname === env.PAGES_HOSTNAME) {
			return handlePages(request, env);
		}

		return notFound();
	},
} satisfies ExportedHandler<Env>;
