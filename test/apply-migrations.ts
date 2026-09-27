import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll } from "vitest";
import { network } from "./network";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
	await applyD1Migrations(testEnv.AUTH_DB, testEnv.TEST_MIGRATIONS);
	network.enable();
});

afterEach(() => network.resetHandlers());
afterAll(() => network.disable());
