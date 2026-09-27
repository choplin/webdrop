import { createAuthClient } from "better-auth/client";

const authClient = createAuthClient({ baseURL: window.location.origin });
const controls = document.querySelector<HTMLElement>("#auth-controls");
const status = document.querySelector<HTMLElement>("#auth-status");
const signInButton = document.querySelector<HTMLButtonElement>("#auth-sign-in");
const signOutButton =
	document.querySelector<HTMLButtonElement>("#auth-sign-out");

function setPending(message: string): void {
	if (status) status.textContent = message;
	if (signInButton) signInButton.disabled = true;
	if (signOutButton) signOutButton.disabled = true;
}

async function refreshSession(): Promise<void> {
	const { data, error } = await authClient.getSession();
	if (error) {
		if (status) status.textContent = "Session unavailable";
		if (signInButton) signInButton.hidden = false;
		if (signOutButton) signOutButton.hidden = true;
		return;
	}

	if (data?.user) {
		if (status) status.textContent = data.user.name || data.user.email;
		if (signInButton) signInButton.hidden = true;
		if (signOutButton) {
			signOutButton.hidden = false;
			signOutButton.disabled = false;
		}
		return;
	}

	if (status) status.textContent = "Not signed in";
	if (signInButton) {
		signInButton.hidden = false;
		signInButton.disabled = false;
	}
	if (signOutButton) signOutButton.hidden = true;
}

signInButton?.addEventListener("click", async () => {
	setPending("Opening Google sign-in…");
	const { error } = await authClient.signIn.social({
		provider: "google",
		callbackURL: "/",
	});
	if (error) await refreshSession();
});

signOutButton?.addEventListener("click", async () => {
	setPending("Signing out…");
	await authClient.signOut();
	await refreshSession();
});

async function initializeAuthentication(): Promise<void> {
	const response = await fetch("/api/config", {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return;
	const config: unknown = await response.json();
	if (
		typeof config !== "object" ||
		config === null ||
		!("features" in config) ||
		typeof config.features !== "object" ||
		config.features === null ||
		!("authentication" in config.features) ||
		config.features.authentication !== "google"
	) {
		return;
	}

	if (controls) controls.hidden = false;
	await refreshSession();
}

void initializeAuthentication();
