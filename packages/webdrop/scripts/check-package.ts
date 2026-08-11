import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
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

	await run(
		"npx",
		[
			"--yes",
			"--package",
			join(temporaryDirectory, archives[0] as string),
			"webdrop",
			"deploy",
			"--domain",
			"webdrop-package.acceptance.test",
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
