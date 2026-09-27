import { env, exports } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { authOrigin, createAuth } from "../src/auth";
import worker from "../src/worker";
import { network } from "./network";

const controlOrigin = "https://webdrop.example.test";

function cookieHeader(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.slice(0, cookie.indexOf(";")))
		.join("; ");
}

function authRequest(
	path: string,
	body: Record<string, unknown>,
	cookie?: string,
	origin = controlOrigin,
): Promise<Response> {
	return exports.default.fetch(`${controlOrigin}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: origin,
			...(cookie === undefined ? {} : { Cookie: cookie }),
		},
		body: JSON.stringify(body),
	});
}

describe("Better Auth browser journey", () => {
	it("removes authentication endpoints when the manifest disables the feature", async () => {
		const disabledEnvironment = {
			APP_DOMAIN: env.APP_DOMAIN,
			ASSETS: env.ASSETS,
			AUTHENTICATION: "disabled" as const,
			SITES: env.SITES,
		};
		const config = await worker.fetch(
			new Request(`${controlOrigin}/api/config`),
			disabledEnvironment,
		);
		expect(config.status).toBe(200);
		expect(await config.json()).toEqual({
			features: { authentication: "disabled" },
		});

		const auth = await worker.fetch(
			new Request(`${controlOrigin}/api/auth/get-session`),
			disabledEnvironment,
		);
		expect(auth.status).toBe(404);
		const currentUser = await worker.fetch(
			new Request(`${controlOrigin}/api/me`),
			disabledEnvironment,
		);
		expect(currentUser.status).toBe(404);
	});

	it("completes Google login, exposes only the user ID, and revokes logout", async () => {
		const { privateKey, publicKey } = await generateKeyPair("RS256");
		const publicJwk = await exportJWK(publicKey);
		Object.assign(publicJwk, {
			alg: "RS256",
			kid: "test-google-key",
			use: "sig",
		});

		const signIn = await authRequest("/api/auth/sign-in/social", {
			provider: "google",
			callbackURL: "/",
		});
		expect(signIn.status).toBe(200);
		const signInBody = await signIn.json<{
			redirect: boolean;
			url: string;
		}>();
		const authorizationUrl = new URL(signInBody.url);
		expect(signInBody.redirect).toBe(true);
		expect(authorizationUrl.origin).toBe("https://accounts.google.com");
		expect(authorizationUrl.searchParams.get("client_id")).toBe(
			"test-google-client-id",
		);
		expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
			`${controlOrigin}/api/auth/callback/google`,
		);
		const state = authorizationUrl.searchParams.get("state");
		const nonce = authorizationUrl.searchParams.get("nonce");
		expect(state).toBeTruthy();

		const now = Math.floor(Date.now() / 1000);
		const idToken = await new SignJWT({
			email: "reviewer@example.test",
			email_verified: true,
			name: "Review User",
			nonce,
			picture: "https://example.test/avatar.png",
		})
			.setProtectedHeader({ alg: "RS256", kid: "test-google-key" })
			.setIssuer("https://accounts.google.com")
			.setAudience("test-google-client-id")
			.setSubject("google-user-1")
			.setIssuedAt(now)
			.setExpirationTime(now + 300)
			.sign(privateKey);

		network.use(
			http.post("https://oauth2.googleapis.com/token", () =>
				HttpResponse.json({
					access_token: "test-access-token",
					expires_in: 3600,
					id_token: idToken,
					scope: "openid email profile",
					token_type: "Bearer",
				}),
			),
			http.get("https://www.googleapis.com/oauth2/v3/certs", () =>
				HttpResponse.json({ keys: [publicJwk] }),
			),
		);

		const callback = await exports.default.fetch(
			`${controlOrigin}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state ?? "")}`,
			{ headers: { Cookie: cookieHeader(signIn) }, redirect: "manual" },
		);
		expect(callback.status).toBe(302);
		expect(callback.headers.get("Location")).toBe("/");
		const sessionCookie = callback.headers
			.getSetCookie()
			.find((cookie) => cookie.includes("session_token="));
		expect(sessionCookie).toContain("HttpOnly");
		expect(sessionCookie).toContain("Max-Age=604800");
		expect(sessionCookie).toContain("Path=/");
		expect(sessionCookie).toContain("SameSite=Lax");
		expect(sessionCookie).toContain("Secure");
		expect(sessionCookie).not.toContain("Domain=");
		const sessionCookies = cookieHeader(callback);

		const currentUser = await exports.default.fetch(`${controlOrigin}/api/me`, {
			headers: { Cookie: sessionCookies },
		});
		expect(currentUser.status).toBe(200);
		const currentUserBody = await currentUser.json<{
			userId: string;
		}>();
		expect(currentUserBody.userId).toBeTruthy();
		expect(Object.keys(currentUserBody)).toEqual(["userId"]);

		const session = await exports.default.fetch(
			`${controlOrigin}/api/auth/get-session`,
			{ headers: { Cookie: sessionCookies } },
		);
		expect(session.status).toBe(200);
		expect(await session.json()).toMatchObject({
			user: {
				email: "reviewer@example.test",
				name: "Review User",
			},
		});

		const rejectedLogout = await authRequest(
			"/api/auth/sign-out",
			{},
			sessionCookies,
			"https://attacker.example",
		);
		expect(rejectedLogout.status).toBe(403);

		const logout = await authRequest("/api/auth/sign-out", {}, sessionCookies);
		expect(logout.status).toBe(200);

		const afterLogout = await exports.default.fetch(`${controlOrigin}/api/me`, {
			headers: { Cookie: sessionCookies },
		});
		expect(afterLogout.status).toBe(401);
	});

	it("derives one trusted HTTPS origin and requires every credential", () => {
		expect(authOrigin("webdrop.example.com")).toBe(
			"https://webdrop.example.com",
		);
		expect(authOrigin("localhost")).toBe("https://localhost:8787");
		expect(() =>
			createAuth({
				...env,
				BETTER_AUTH_SECRET: "",
				GOOGLE_CLIENT_ID: "client",
				GOOGLE_CLIENT_SECRET: "secret",
			}),
		).toThrow("BETTER_AUTH_SECRET must be configured");
		expect(() =>
			createAuth({
				...env,
				BETTER_AUTH_SECRET: "too-short",
				GOOGLE_CLIENT_ID: "client",
				GOOGLE_CLIENT_SECRET: "secret",
			}),
		).toThrow("at least 32 characters");
		expect(() =>
			createAuth({
				...env,
				BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
				GOOGLE_CLIENT_ID: "",
				GOOGLE_CLIENT_SECRET: "secret",
			}),
		).toThrow("GOOGLE_CLIENT_ID must be configured");
		expect(() =>
			createAuth({
				...env,
				BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
				GOOGLE_CLIENT_ID: "client",
				GOOGLE_CLIENT_SECRET: "",
			}),
		).toThrow("GOOGLE_CLIENT_SECRET must be configured");
	});
});
