import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	authenticationMode,
	loadDeployManifest,
	parseDeployManifest,
	resolveManifestSecrets,
} from "../../deploy/manifest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { force: true, recursive: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "webdrop-manifest-test-"));
	temporaryDirectories.push(path);
	return path;
}

const googleManifest = `version: 1
target:
  provider: cloudflare
  hostname: webdrop.example.com
features:
  authentication:
    provider: google
secrets:
  BETTER_AUTH_SECRET:
    source: environment
    name: WEB_AUTH_SECRET
  GOOGLE_CLIENT_ID:
    source: dotenv
    path: auth.env
    name: CLIENT_ID
  GOOGLE_CLIENT_SECRET:
    source: dotenv
    path: auth.env
    name: CLIENT_SECRET
`;

describe("deploy manifest", () => {
	it("describes a Cloudflare deployment with Google authentication", () => {
		const manifest = parseDeployManifest(googleManifest);
		expect(manifest.target).toEqual({
			provider: "cloudflare",
			hostname: "webdrop.example.com",
		});
		expect(manifest.features.authentication).toEqual({ provider: "google" });
	});

	it("supports upload and viewing without authentication resources", () => {
		const manifest = parseDeployManifest(`version: 1
target:
  provider: cloudflare
  hostname: webdrop.example.com
features:
  authentication: disabled
`);
		expect(manifest.features.authentication).toBe("disabled");
		expect(authenticationMode({ directory: "", manifest, path: "" })).toBe(
			"disabled",
		);
	});

	it("only treats a missing default manifest as absent", async () => {
		const missingDirectory = await temporaryDirectory();
		await expect(
			loadDeployManifest(undefined, missingDirectory),
		).resolves.toBeUndefined();

		const unreadableDirectory = await temporaryDirectory();
		await mkdir(join(unreadableDirectory, "webdrop.yaml"));
		await expect(
			loadDeployManifest(undefined, unreadableDirectory),
		).rejects.toMatchObject({ code: "EISDIR" });
	});

	it("resolves environment and manifest-relative dotenv secret sources", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "webdrop.yaml"), googleManifest);
		await writeFile(
			join(directory, "auth.env"),
			"CLIENT_ID=test-client-id\nCLIENT_SECRET=test-client-secret\n",
		);
		const loaded = await loadDeployManifest(undefined, directory);
		if (loaded === undefined)
			throw new Error("Expected an auto-loaded manifest");
		expect(
			await resolveManifestSecrets(loaded, {
				WEB_AUTH_SECRET: "a-test-secret-with-at-least-32-characters",
			}),
		).toEqual({
			BETTER_AUTH_SECRET: "a-test-secret-with-at-least-32-characters",
			GOOGLE_CLIENT_ID: "test-client-id",
			GOOGLE_CLIENT_SECRET: "test-client-secret",
		});
	});

	it("validates and returns normalized secret values", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "webdrop.yaml"), googleManifest);
		await writeFile(
			join(directory, "auth.env"),
			"CLIENT_ID=  test-client-id  \nCLIENT_SECRET=  test-client-secret  \n",
		);
		const loaded = await loadDeployManifest(undefined, directory);
		if (loaded === undefined)
			throw new Error("Expected an auto-loaded manifest");

		await expect(
			resolveManifestSecrets(loaded, {
				WEB_AUTH_SECRET: `${" ".repeat(32)}x`,
			}),
		).rejects.toThrow("must provide at least 32 characters");
		await expect(
			resolveManifestSecrets(loaded, {
				WEB_AUTH_SECRET: "replace-me",
			}),
		).rejects.toThrow("must provide at least 32 characters");

		expect(
			await resolveManifestSecrets(loaded, {
				WEB_AUTH_SECRET: "  a-test-secret-with-at-least-32-characters  ",
			}),
		).toEqual({
			BETTER_AUTH_SECRET: "a-test-secret-with-at-least-32-characters",
			GOOGLE_CLIENT_ID: "test-client-id",
			GOOGLE_CLIENT_SECRET: "test-client-secret",
		});
	});

	it("rejects unsupported providers and incomplete secret declarations", () => {
		expect(() =>
			parseDeployManifest(googleManifest.replace("cloudflare", "gcp")),
		).toThrow("target.provider gcp is not supported");
		expect(() =>
			parseDeployManifest(
				googleManifest.replace(/ {2}GOOGLE_CLIENT_SECRET:[\s\S]*$/, ""),
			),
		).toThrow("secrets.GOOGLE_CLIENT_SECRET is required");
	});

	it("does not silently ignore secrets when authentication is disabled", () => {
		expect(() =>
			parseDeployManifest(`version: 1
target:
  provider: cloudflare
  hostname: webdrop.example.com
features:
  authentication: disabled
secrets:
  GOOGLE_CLIENT_ID:
    source: environment
    name: GOOGLE_CLIENT_ID
`),
		).toThrow("secrets must be omitted");
	});
});
