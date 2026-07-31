import {
	selectedRelativePaths,
	setHtmxMultipartParameters,
} from "./publish-upload.js";

const maxFiles = 100;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 50 * 1024 * 1024;

interface FilePart {
	field: string;
	path: string;
}

interface PreparedUpload {
	formData: FormData;
	fileCount: number;
	totalBytes: number;
}

interface HtmxProgressDetail {
	lengthComputable: boolean;
	loaded: number;
	total: number;
}

interface HtmxBeforeSwapDetail {
	shouldSwap: boolean;
	isError: boolean;
	xhr: XMLHttpRequest;
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true;
		}
	}

	return false;
}

function isSafeRelativePath(path: string): boolean {
	if (
		path.length === 0 ||
		path.startsWith("/") ||
		path.includes("\\") ||
		hasControlCharacter(path)
	) {
		return false;
	}

	const segments = path.split("/");
	if (
		segments.some(
			(segment) => segment.length === 0 || segment === "." || segment === "..",
		)
	) {
		return false;
	}

	return !(
		path === "_meta" ||
		path.startsWith("_meta/") ||
		path === "sites" ||
		path.startsWith("sites/")
	);
}

function prepareUpload(files: FileList): PreparedUpload | string {
	const selectedFiles = Array.from(files);
	if (selectedFiles.length === 0) {
		return "Choose a directory containing index.html.";
	}

	if (selectedFiles.length > maxFiles) {
		return "A publish can contain at most 100 files.";
	}

	const relativePaths = selectedRelativePaths(selectedFiles);
	if ("error" in relativePaths) {
		return relativePaths.error;
	}

	const paths = relativePaths.paths;
	if (!paths.every(isSafeRelativePath)) {
		return "One or more selected paths are not safe to publish.";
	}

	if (!paths.includes("index.html")) {
		return "The selected directory must contain index.html at its root.";
	}

	if (new Set(paths).size !== paths.length) {
		return "Each selected file must have a unique relative path.";
	}

	let totalBytes = 0;
	for (const file of selectedFiles) {
		if (file.size > maxFileBytes) {
			return `${file.name} is larger than 10 MiB.`;
		}

		totalBytes += file.size;
		if (totalBytes > maxTotalBytes) {
			return "The selected directory is larger than 50 MiB.";
		}
	}

	const formData = new FormData();
	const parts: FilePart[] = paths.map((path, index) => ({
		field: `file-${index}`,
		path,
	}));
	formData.set("files", JSON.stringify(parts));
	for (const [index, file] of selectedFiles.entries()) {
		formData.set(`file-${index}`, file, file.name);
	}

	return { formData, fileCount: selectedFiles.length, totalBytes };
}

function isHtmxProgressDetail(value: unknown): value is HtmxProgressDetail {
	return (
		typeof value === "object" &&
		value !== null &&
		"lengthComputable" in value &&
		"loaded" in value &&
		"total" in value &&
		typeof value.lengthComputable === "boolean" &&
		typeof value.loaded === "number" &&
		typeof value.total === "number"
	);
}

function isHtmxBeforeSwapDetail(value: unknown): value is HtmxBeforeSwapDetail {
	return (
		typeof value === "object" &&
		value !== null &&
		"shouldSwap" in value &&
		"isError" in value &&
		"xhr" in value &&
		typeof value.shouldSwap === "boolean" &&
		typeof value.isError === "boolean" &&
		value.xhr instanceof XMLHttpRequest
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) {
		return `${Math.ceil(bytes / 1024)} KiB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const form = document.querySelector<HTMLFormElement>("#publish-form");
const fileInput = document.querySelector<HTMLInputElement>("#site-files");
const clientValidation = document.querySelector<HTMLElement>(
	"#publish-client-validation",
);
const selectionSummary =
	document.querySelector<HTMLElement>("#selection-summary");
const progress =
	document.querySelector<HTMLProgressElement>("#publish-progress");
const progressStatus = document.querySelector<HTMLElement>(
	"#publish-progress-status",
);

function setPublishState(state: "invalid" | "ready" | "uploading"): void {
	if (form) {
		form.dataset.publishState = state;
	}

	if (fileInput) {
		fileInput.disabled = state === "uploading";
	}
}

function showClientValidation(message: string | null): void {
	if (!clientValidation) {
		return;
	}

	clientValidation.hidden = message === null;
	clientValidation.textContent = message ?? "";
}

function updateSelectionSummary(): PreparedUpload | null {
	if (!fileInput || !selectionSummary) {
		return null;
	}

	if (!fileInput.files) {
		showClientValidation("Choose a directory containing index.html.");
		selectionSummary.textContent = "No publish request is ready.";
		setPublishState("invalid");
		return null;
	}

	const prepared = prepareUpload(fileInput.files);
	if (typeof prepared === "string") {
		showClientValidation(prepared);
		selectionSummary.textContent = "No publish request is ready.";
		setPublishState("invalid");
		return null;
	}

	showClientValidation(null);
	selectionSummary.textContent = `${prepared.fileCount} files, ${formatBytes(prepared.totalBytes)} ready to publish.`;
	setPublishState("ready");
	return prepared;
}

fileInput?.addEventListener("change", () => {
	updateSelectionSummary();
});

form?.addEventListener("htmx:configRequest", (event) => {
	if (!(event instanceof CustomEvent)) {
		return;
	}

	const prepared = updateSelectionSummary();
	if (!prepared) {
		event.preventDefault();
		return;
	}

	if (!setHtmxMultipartParameters(event.detail, prepared.formData)) {
		showClientValidation(
			"The upload request could not be prepared. Try again.",
		);
		event.preventDefault();
	}
});

form?.addEventListener("htmx:beforeRequest", () => {
	form.setAttribute("aria-busy", "true");
	setPublishState("uploading");
	if (progress) {
		progress.value = 0;
	}
	if (progressStatus) {
		progressStatus.textContent = "Uploading 0%.";
	}
});

form?.addEventListener("htmx:xhr:progress", (event) => {
	if (
		!(event instanceof CustomEvent) ||
		!isHtmxProgressDetail(event.detail) ||
		!event.detail.lengthComputable ||
		event.detail.total === 0
	) {
		return;
	}

	const percent = Math.min(
		100,
		Math.round((event.detail.loaded / event.detail.total) * 100),
	);
	if (progress) {
		progress.value = percent;
	}
	if (progressStatus) {
		progressStatus.textContent = `Uploading ${percent}%.`;
	}
});

form?.addEventListener("htmx:afterRequest", () => {
	form.removeAttribute("aria-busy");
	setPublishState("ready");
});

form?.addEventListener("htmx:beforeSwap", (event) => {
	if (
		!(event instanceof CustomEvent) ||
		!isHtmxBeforeSwapDetail(event.detail)
	) {
		return;
	}

	if (event.detail.xhr.status >= 400) {
		event.detail.shouldSwap = true;
		event.detail.isError = false;
	}
});
