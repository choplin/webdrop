const controlDocument =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Webdrop</title></head><body><main><h1>Webdrop control</h1></main></body></html>';
const fixedContent =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Webdrop preview</title></head><body><main><h1>Webdrop fixed content</h1></main></body></html>';
const fixedContentPath = "/p/demo/";

const pagesHeaders = {
	"Cache-Control": "no-store",
	"Content-Security-Policy":
		"base-uri 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'",
	"Content-Type": "text/html; charset=utf-8",
	"Permissions-Policy": "camera=(), geolocation=(), microphone=()",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
} as const;

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

function pagesNotFound(): Response {
	return new Response("Not found", { status: 404, headers: pagesHeaders });
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

function fixedPageResponse(method: string): Response {
	return new Response(method === "HEAD" ? null : fixedContent, {
		headers: pagesHeaders,
	});
}

function handleControl(request: Request): Response {
	const url = new URL(request.url);
	if (request.method !== "GET" || url.pathname !== "/") {
		return notFound();
	}

	return new Response(controlDocument, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
		},
	});
}

function handlePages(request: Request): Response {
	const url = new URL(request.url);
	if (url.pathname !== fixedContentPath) {
		return pagesNotFound();
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		return pagesMethodNotAllowed();
	}

	if (serviceWorkerRequest(request)) {
		return new Response("Forbidden", { status: 403, headers: pagesHeaders });
	}

	return fixedPageResponse(request.method);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const hostname = new URL(request.url).hostname;

		if (hostname === env.CONTROL_HOSTNAME) {
			return handleControl(request);
		}

		if (hostname === env.PAGES_HOSTNAME) {
			return handlePages(request);
		}

		return notFound();
	},
} satisfies ExportedHandler<Env>;
