import { betterAuth } from "better-auth";

const sessionExpiresInSeconds = 7 * 24 * 60 * 60;
const sessionUpdateAgeSeconds = 24 * 60 * 60;

export interface AuthEnvironment {
	APP_DOMAIN: string;
	AUTH_DB: D1Database;
	BETTER_AUTH_SECRET: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
}

function required(value: string, name: string): string {
	const trimmed = value.trim();
	if (trimmed === "") {
		throw new Error(`${name} must be configured`);
	}
	return trimmed;
}

function authSecret(value: string): string {
	const secret = required(value, "BETTER_AUTH_SECRET");
	if (secret.length < 32) {
		throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
	}
	return secret;
}

export function authOrigin(appDomain: string): string {
	const hostname = required(appDomain, "APP_DOMAIN");
	return hostname === "localhost"
		? "https://localhost:8787"
		: `https://${hostname}`;
}

export function createAuth(env: AuthEnvironment) {
	const baseURL = authOrigin(env.APP_DOMAIN);
	return betterAuth({
		appName: "Webdrop",
		baseURL,
		database: env.AUTH_DB,
		secret: authSecret(env.BETTER_AUTH_SECRET),
		trustedOrigins: [baseURL],
		socialProviders: {
			google: {
				clientId: required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
				clientSecret: required(
					env.GOOGLE_CLIENT_SECRET,
					"GOOGLE_CLIENT_SECRET",
				),
			},
		},
		session: {
			expiresIn: sessionExpiresInSeconds,
			updateAge: sessionUpdateAgeSeconds,
		},
		advanced: {
			useSecureCookies: true,
			defaultCookieAttributes: {
				httpOnly: true,
				path: "/",
				sameSite: "lax",
				secure: true,
			},
			ipAddress: {
				ipAddressHeaders: ["cf-connecting-ip"],
			},
		},
	});
}

export type WebdropAuth = ReturnType<typeof createAuth>;

export async function authenticatedUserId(
	request: Request,
	auth: WebdropAuth,
): Promise<string | null> {
	const session = await auth.api.getSession({ headers: request.headers });
	return session?.user.id ?? null;
}
