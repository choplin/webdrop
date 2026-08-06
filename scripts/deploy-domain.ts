const placeholderDomains = new Set([
	"webdrop.example.invalid",
	"webdrop.example.test",
]);

export interface DomainInputs {
	argument: string | undefined;
	environment: string | undefined;
	configuration: string | undefined;
}

function normalizeDomain(value: string): string {
	return value.trim().toLowerCase().replace(/\.$/, "");
}

export function validateAppDomain(value: string): string {
	const domain = normalizeDomain(value);
	if (domain === "" || placeholderDomains.has(domain)) {
		throw new Error(
			"Provide an application domain such as webdrop.example.com",
		);
	}
	if (domain.length > 253 || domain.includes("://") || domain.includes("/")) {
		throw new Error(
			"The application domain must be a hostname, not a URL or path",
		);
	}

	const labels = domain.split(".");
	if (
		labels.length < 2 ||
		labels.some(
			(label) =>
				label.length === 0 ||
				label.length > 63 ||
				!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
		)
	) {
		throw new Error("The application domain is not a valid DNS hostname");
	}

	const pagesDomain = `pages.${domain}`;
	if (pagesDomain.length > 253) {
		throw new Error(
			"The application domain is too long to add the pages prefix",
		);
	}

	return domain;
}

export function resolveAppDomain(inputs: DomainInputs): string {
	const candidates = [
		inputs.argument,
		inputs.environment,
		inputs.configuration !== undefined &&
		placeholderDomains.has(normalizeDomain(inputs.configuration))
			? undefined
			: inputs.configuration,
	]
		.filter(
			(value): value is string => value !== undefined && value.trim() !== "",
		)
		.map(validateAppDomain);

	if (candidates.length === 0) {
		throw new Error(
			"Pass --domain <hostname> or set APP_DOMAIN before deploying",
		);
	}
	if (new Set(candidates).size !== 1) {
		throw new Error(
			"The domain inputs disagree; provide one application domain",
		);
	}

	return candidates[0] as string;
}

export function pagesDomainFor(appDomain: string): string {
	return `pages.${validateAppDomain(appDomain)}`;
}
