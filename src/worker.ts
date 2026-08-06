const maxFiles = 100;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 50 * 1024 * 1024;
const maxMetadataBytes = 2048;
const pagesPrefix = "/p/";
const metadataPrefix = "_meta/";
const sitesPrefix = "sites/";
const defaultTtlSeconds = 24 * 60 * 60;
const uploadingCleanupAgeMilliseconds = 24 * 60 * 60 * 1000;
const cleanupScanLimit = 1000;
const cleanupDeleteBatchSize = 1000;
const allowedTtlSeconds = new Map([
	["3600", 60 * 60],
	["86400", defaultTtlSeconds],
	["604800", 7 * 24 * 60 * 60],
]);
const allowedTtlMilliseconds = new Set(
	[...allowedTtlSeconds.values()].map((seconds) => seconds * 1000),
);

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
	expiresAt: string;
	fileCount: number;
	totalBytes: number;
}

interface PublishPayload {
	files: PublishedFile[];
	totalBytes: number;
	ttlSeconds: number;
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
	expiresAt: string;
}

type CleanupReason = "expired" | "abandoned_upload";
type CleanupSiteResult =
	| "already_absent"
	| "deleted"
	| "failed"
	| "skipped_changed";

interface CleanupListResult {
	objects: { key: string }[];
	truncated: boolean;
}

interface CleanupObjectBody {
	size: number;
	text(): Promise<string>;
}

interface CleanupStorage {
	list(options: { prefix: string; limit: number }): Promise<CleanupListResult>;
	get(key: string): Promise<CleanupObjectBody | null>;
	delete(keys: string | string[]): Promise<void>;
}

interface CleanupLog {
	siteId?: string;
	reason: CleanupReason | "scan_limit_exceeded";
	deletedObjects: number;
	result: CleanupSiteResult | "warning";
}

export type CleanupResult =
	| {
			result: "completed";
			scannedSites: number;
			deletedSites: number;
			skippedSites: number;
	  }
	| {
			result: "scan_limit_exceeded";
			scannedSites: number;
			deletedSites: 0;
			skippedSites: 0;
	  };

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

async function controlPage(
	request: Request,
	assets: Fetcher,
): Promise<Response> {
	const assetUrl = new URL(request.url);
	assetUrl.pathname = "/client/";
	const assetResponse = await assets.fetch(new Request(assetUrl, request));
	const headers = new Headers(assetResponse.headers);

	for (const [name, value] of Object.entries(controlHtmlHeaders)) {
		headers.set(name, value);
	}

	return new Response(assetResponse.body, {
		status: assetResponse.status,
		statusText: assetResponse.statusText,
		headers,
	});
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

function publishSuccessFragment(url: string, expiresAt: string): Response {
	const safeUrl = escapeHtml(url);
	const safeExpiresAt = escapeHtml(expiresAt);
	return new Response(
		`<section class="publish-complete" aria-labelledby="publish-complete-title"><div class="publish-complete-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m3 12.5 6 6L21 5.5" /></svg></div><div class="publish-complete-copy" role="status" aria-live="polite" aria-atomic="true"><h2 id="publish-complete-title">Site published.</h2><p>Live until <time datetime="${safeExpiresAt}">${safeExpiresAt}</time>.</p></div><a class="btn btn-primary publish-complete-link" href="${safeUrl}"><span>Open published site</span><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg></a></section>`,
		{
			status: 201,
			headers: { ...controlHtmlHeaders, "HX-Retarget": "#publish-form" },
		},
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
	const ttlEntries = formData.getAll("ttl");
	const ttlValue = ttlEntries.length === 0 ? null : ttlEntries[0];
	if (
		ttlEntries.length > 1 ||
		(ttlValue !== null && typeof ttlValue !== "string")
	) {
		return badRequest("ttl must be one approved duration");
	}

	const ttlSeconds =
		ttlValue === null ? defaultTtlSeconds : allowedTtlSeconds.get(ttlValue);
	if (ttlSeconds === undefined) {
		return badRequest("ttl must be one approved duration");
	}

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

	return { files, totalBytes, ttlSeconds };
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
		"expiresAt" in value &&
		typeof value.siteId === "string" &&
		typeof value.url === "string" &&
		typeof value.expiresAt === "string"
	);
}

function parseCanonicalTimestamp(value: string): number | null {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) &&
		new Date(timestamp).toISOString() === value
		? timestamp
		: null;
}

function isSiteMetadata(value: unknown): value is SiteMetadata {
	return (
		typeof value === "object" &&
		value !== null &&
		"status" in value &&
		"createdAt" in value &&
		"expiresAt" in value &&
		"fileCount" in value &&
		"totalBytes" in value &&
		(value.status === "uploading" || value.status === "active") &&
		typeof value.createdAt === "string" &&
		typeof value.expiresAt === "string" &&
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

function cleanupReason(
	metadata: SiteMetadata,
	now: number,
): CleanupReason | null {
	if (metadata.status === "active") {
		const expiresAt = parseCanonicalTimestamp(metadata.expiresAt);
		return expiresAt !== null && expiresAt <= now ? "expired" : null;
	}

	const createdAt = parseCanonicalTimestamp(metadata.createdAt);
	return createdAt !== null && createdAt + uploadingCleanupAgeMilliseconds < now
		? "abandoned_upload"
		: null;
}

function siteIdFromMetadataKey(key: string): string | null {
	if (!key.startsWith(metadataPrefix) || !key.endsWith(".json")) {
		return null;
	}

	const siteId = key.slice(metadataPrefix.length, -".json".length);
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		siteId,
	)
		? siteId
		: null;
}

async function readCleanupMetadata(
	storage: CleanupStorage,
	key: string,
): Promise<SiteMetadata | null> {
	const object = await storage.get(key);
	if (!object || object.size > maxMetadataBytes) {
		return null;
	}

	return parseMetadata(await object.text());
}

function defaultCleanupLogger(entry: CleanupLog): void {
	const message = JSON.stringify(entry);
	if (entry.result === "warning") {
		console.warn(message);
		return;
	}

	console.log(message);
}

async function deleteSiteObjects(
	storage: CleanupStorage,
	siteId: string,
	onDeleted: (count: number) => void,
): Promise<void> {
	const prefix = `${sitesPrefix}${siteId}/`;

	while (true) {
		const page = await storage.list({
			prefix,
			limit: cleanupDeleteBatchSize,
		});
		const keys = page.objects.map(({ key }) => key);
		if (keys.length === 0) {
			return;
		}

		await storage.delete(keys);
		onDeleted(keys.length);
		if (!page.truncated) {
			return;
		}
	}
}

export async function cleanupSites(
	storage: CleanupStorage,
	now: () => number = () => Date.now(),
	log: (entry: CleanupLog) => void = defaultCleanupLogger,
): Promise<CleanupResult> {
	const scanTime = now();
	const metadataPage = await storage.list({
		prefix: metadataPrefix,
		limit: cleanupScanLimit,
	});
	if (metadataPage.truncated) {
		log({
			reason: "scan_limit_exceeded",
			deletedObjects: 0,
			result: "warning",
		});
		return {
			result: "scan_limit_exceeded",
			scannedSites: metadataPage.objects.length,
			deletedSites: 0,
			skippedSites: 0,
		};
	}

	const candidates: { siteId: string; reason: CleanupReason }[] = [];
	for (const { key } of metadataPage.objects) {
		const siteId = siteIdFromMetadataKey(key);
		if (!siteId) {
			continue;
		}

		const metadata = await readCleanupMetadata(storage, key);
		const reason = metadata ? cleanupReason(metadata, scanTime) : null;
		if (reason) {
			candidates.push({ siteId, reason });
		}
	}

	let deletedSites = 0;
	let skippedSites = 0;
	for (const candidate of candidates) {
		const key = metadataKey(candidate.siteId);
		const currentMetadata = await readCleanupMetadata(storage, key);
		if (!currentMetadata) {
			skippedSites += 1;
			log({
				siteId: candidate.siteId,
				reason: candidate.reason,
				deletedObjects: 0,
				result: "already_absent",
			});
			continue;
		}

		const currentReason = cleanupReason(currentMetadata, scanTime);
		if (!currentReason) {
			skippedSites += 1;
			log({
				siteId: candidate.siteId,
				reason: candidate.reason,
				deletedObjects: 0,
				result: "skipped_changed",
			});
			continue;
		}

		let deletedObjects = 0;
		try {
			await deleteSiteObjects(storage, candidate.siteId, (count) => {
				deletedObjects += count;
			});
			await storage.delete(key);
			deletedObjects += 1;
			deletedSites += 1;
			log({
				siteId: candidate.siteId,
				reason: currentReason,
				deletedObjects,
				result: "deleted",
			});
		} catch (error) {
			log({
				siteId: candidate.siteId,
				reason: currentReason,
				deletedObjects,
				result: "failed",
			});
			throw error;
		}
	}

	return {
		result: "completed",
		scannedSites: metadataPage.objects.length,
		deletedSites,
		skippedSites,
	};
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
	now: () => number,
): Promise<SiteMetadata | null> {
	const metadataObject = await bucket.get(metadataKey(siteId));
	if (!metadataObject || metadataObject.size > maxMetadataBytes) {
		return null;
	}

	const metadata = parseMetadata(await metadataObject.text());
	if (metadata?.status !== "active") {
		return null;
	}

	const createdAt = parseCanonicalTimestamp(metadata.createdAt);
	const expiresAt = parseCanonicalTimestamp(metadata.expiresAt);
	return createdAt !== null &&
		expiresAt !== null &&
		allowedTtlMilliseconds.has(expiresAt - createdAt) &&
		now() < expiresAt
		? metadata
		: null;
}

export async function publishSite(
	request: Request,
	storage: PublishStorage,
	pagesHostname: string,
	createSiteId: () => string = () => crypto.randomUUID(),
	now: () => number = () => Date.now(),
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
	const createdAt = now();
	const metadata: SiteMetadata = {
		status: "uploading",
		createdAt: new Date(createdAt).toISOString(),
		expiresAt: new Date(createdAt + payload.ttlSeconds * 1000).toISOString(),
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
			expiresAt: metadata.expiresAt,
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
			return "We could not use this file or folder. Check the upload limits and paths.";
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

	const response = await publishSite(
		request,
		env.SITES,
		`sites.${env.APP_DOMAIN}`,
	);
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

	return publishSuccessFragment(publishedSite.url, publishedSite.expiresAt);
}

async function handleControl(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/publish") {
		return handleControlPublish(request, env);
	}

	if (
		request.method === "GET" &&
		(url.pathname.startsWith("/assets/") ||
			url.pathname === "/@vite/client" ||
			url.pathname.startsWith("/node_modules/.vite/") ||
			/^\/client\/[^/]+\.(?:css|png|ts)$/.test(url.pathname))
	) {
		return env.ASSETS.fetch(request);
	}

	if (request.method !== "GET" || url.pathname !== "/") {
		return notFound();
	}

	return controlPage(request, env.ASSETS);
}

export async function handlePages(
	request: Request,
	env: Pick<Env, "SITES">,
	now: () => number = () => Date.now(),
): Promise<Response> {
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

	if (!(await readActiveMetadata(env.SITES, page.siteId, now))) {
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

		if (hostname === env.APP_DOMAIN) {
			return handleControl(request, env);
		}

		if (hostname === `sites.${env.APP_DOMAIN}`) {
			return handlePages(request, env);
		}

		return notFound();
	},
	async scheduled(controller: ScheduledController, env: Env): Promise<void> {
		await cleanupSites(env.SITES, () => controller.scheduledTime);
	},
} satisfies ExportedHandler<Env>;
