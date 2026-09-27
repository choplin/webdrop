import { spawn } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function run(
	command: string,
	arguments_: string[],
	cwd: string,
	environment: NodeJS.ProcessEnv = process.env,
) {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, arguments_, {
			cwd,
			env: environment,
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
					signal === null
						? `${command} exited with status ${code ?? "unknown"}`
						: `${command} was terminated by ${signal}`,
				),
			);
		});
	});
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(packageDirectory, "../../.wrangler");
await mkdir(temporaryRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(
	join(temporaryRoot, "webdrop-package-"),
);

try {
	await run(
		"pnpm",
		["pack", "--pack-destination", temporaryDirectory],
		packageDirectory,
	);
	const archives = (await readdir(temporaryDirectory)).filter((entry) =>
		entry.endsWith(".tgz"),
	);
	if (archives.length !== 1) {
		throw new Error(`Expected one package archive, found ${archives.length}`);
	}
	const stagedConfig = JSON.parse(
		await readFile(
			join(packageDirectory, "template/webdrop/wrangler.json"),
			"utf8",
		),
	) as { d1_databases?: Array<{ binding?: string; migrations_dir?: string }> };
	const authDatabase = stagedConfig.d1_databases?.find(
		(database) => database.binding === "AUTH_DB",
	);
	if (authDatabase?.migrations_dir !== "migrations") {
		throw new Error(
			"Packaged AUTH_DB must use the packaged migrations directory",
		);
	}
	await access(
		join(packageDirectory, "template/webdrop/migrations/0001_better_auth.sql"),
	);
	await writeFile(
		join(temporaryDirectory, "webdrop.yaml"),
		`version: 1
target:
  provider: cloudflare
  hostname: webdrop-package.acceptance.test
features:
  authentication: disabled
`,
	);

	await run(
		"npx",
		[
			"--yes",
			"--package",
			join(temporaryDirectory, archives[0] as string),
			"webdrop",
			"deploy",
			"--dry-run",
			"--json",
		],
		temporaryDirectory,
		{
			...process.env,
			TMPDIR: temporaryDirectory,
			npm_config_cache: join(temporaryDirectory, "npm-cache"),
		},
	);
} finally {
	await rm(temporaryDirectory, { force: true, recursive: true });
}
