import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "https://localhost:8787";

interface LocalResponse {
	body: string;
	status: number;
}

function run(command: string, arguments_: string[]): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, arguments_, {
			env: { ...process.env, CI: "true" },
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(
				new Error(
					`${command} exited with ${signal === null ? `code ${code}` : `signal ${signal}`}`,
				),
			);
		});
	});
}

function localRequest(
	path: string,
	method = "GET",
	body?: string,
): Promise<LocalResponse> {
	return new Promise((resolvePromise, reject) => {
		const request_ = request(
			`${origin}${path}`,
			{
				method,
				rejectUnauthorized: false,
				headers: {
					Host: "webdrop.example.test",
					...(body === undefined
						? {}
						: {
								"Content-Length": Buffer.byteLength(body),
								"Content-Type": "application/json",
								Origin: "https://webdrop.example.test",
							}),
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					resolvePromise({
						body: Buffer.concat(chunks).toString("utf8"),
						status: response.statusCode ?? 0,
					});
				});
			},
		);
		request_.on("error", reject);
		if (body !== undefined) request_.write(body);
		request_.end();
	});
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "webdrop-preview-"));
const previewVarsPath = join(temporaryDirectory, ".dev.vars");
const previewStatePath = join(temporaryDirectory, "state");
await writeFile(
	previewVarsPath,
	[
		"BETTER_AUTH_SECRET=file-secret-that-is-at-least-32-characters",
		"GOOGLE_CLIENT_ID=file-google-client-id",
		"GOOGLE_CLIENT_SECRET=file-google-client-secret",
	].join("\n"),
	{ mode: 0o600 },
);

try {
	await run("pnpm", [
		"exec",
		"wrangler",
		"d1",
		"migrations",
		"apply",
		"AUTH_DB",
		"--local",
		"--persist-to",
		previewStatePath,
	]);
} catch (error) {
	await rm(temporaryDirectory, { recursive: true });
	throw error;
}

const previewProcess = spawn("pnpm", ["preview"], {
	env: {
		...process.env,
		BETTER_AUTH_SECRET: "environment-secret-that-is-at-least-32-characters",
		GOOGLE_CLIENT_ID: "environment-google-client-id",
		GOOGLE_CLIENT_SECRET: "environment-google-client-secret",
		WEBDROP_PREVIEW_PERSIST_PATH: previewStatePath,
		WEBDROP_PREVIEW_VARS_PATH: previewVarsPath,
	},
	stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
previewProcess.stdout.on("data", (chunk: Buffer) => {
	output = `${output}${chunk.toString("utf8")}`.slice(-4000);
});
previewProcess.stderr.on("data", (chunk: Buffer) => {
	output = `${output}${chunk.toString("utf8")}`.slice(-4000);
});

try {
	const deadline = Date.now() + 20_000;
	while (true) {
		try {
			const response = await localRequest("/");
			if (response.status === 200) break;
		} catch {
			// The preview server is still starting.
		}
		if (previewProcess.exitCode !== null) {
			throw new Error(`Preview exited before readiness:\n${output}`);
		}
		if (Date.now() >= deadline) {
			throw new Error(`Preview did not become ready:\n${output}`);
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
	}

	const signIn = await localRequest(
		"/api/auth/sign-in/social",
		"POST",
		JSON.stringify({ provider: "google", callbackURL: "/" }),
	);
	if (signIn.status !== 200) {
		throw new Error(
			`Preview Google sign-in returned ${signIn.status}:\n${output}`,
		);
	}
	const result = JSON.parse(signIn.body) as unknown;
	if (
		typeof result !== "object" ||
		result === null ||
		!("url" in result) ||
		typeof result.url !== "string" ||
		new URL(result.url).origin !== "https://accounts.google.com"
	) {
		throw new Error(
			"Preview Google sign-in returned an invalid authorization URL",
		);
	}
	if (
		new URL(result.url).searchParams.get("client_id") !==
		"file-google-client-id"
	) {
		throw new Error("Production preview did not prefer .dev.vars credentials");
	}
	console.log("Production preview auth: OK");
} finally {
	previewProcess.kill("SIGTERM");
	await rm(temporaryDirectory, { recursive: true });
}
