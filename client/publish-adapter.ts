import { selectedRelativePaths } from "./publish-upload.js";

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

interface UploadFile {
	file: File;
	relativePath?: string;
}

interface DroppedFileEntry {
	isFile: true;
	isDirectory: false;
	name: string;
	file(
		successCallback: (file: File) => void,
		errorCallback?: (error: DOMException) => void,
	): void;
}

interface DroppedDirectoryReader {
	readEntries(
		successCallback: (entries: DroppedEntry[]) => void,
		errorCallback?: (error: DOMException) => void,
	): void;
}

interface DroppedDirectoryEntry {
	isFile: false;
	isDirectory: true;
	name: string;
	createReader(): DroppedDirectoryReader;
}

type DroppedEntry = DroppedFileEntry | DroppedDirectoryEntry;

function droppedEntry(item: DataTransferItem): DroppedEntry | null {
	const candidate = item as unknown as {
		webkitGetAsEntry?: () => DroppedEntry | null;
	};
	return candidate.webkitGetAsEntry?.call(item) ?? null;
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

function prepareUpload(selectedFiles: UploadFile[]): PreparedUpload | string {
	if (selectedFiles.length === 0) {
		return "Choose an HTML file or a folder containing index.html.";
	}

	if (selectedFiles.length > maxFiles) {
		return "A publish can contain at most 100 files.";
	}

	const relativePaths = selectedRelativePaths(
		selectedFiles.map(({ file, relativePath }) => ({
			name: file.name,
			size: file.size,
			webkitRelativePath: file.webkitRelativePath,
			relativePath,
		})),
	);
	if ("error" in relativePaths) {
		return relativePaths.error;
	}

	const paths = relativePaths.paths;
	if (!paths.every(isSafeRelativePath)) {
		return "One or more selected paths are not safe to publish.";
	}

	if (!paths.includes("index.html")) {
		return "The selected folder must contain index.html at its root.";
	}

	if (new Set(paths).size !== paths.length) {
		return "Each selected file must have a unique relative path.";
	}

	let totalBytes = 0;
	for (const { file } of selectedFiles) {
		if (file.size > maxFileBytes) {
			return `${file.name} is larger than 10 MiB.`;
		}

		totalBytes += file.size;
		if (totalBytes > maxTotalBytes) {
			return "The selected file or folder is larger than 50 MiB.";
		}
	}

	const formData = new FormData();
	const parts: FilePart[] = paths.map((path, index) => ({
		field: `file-${index}`,
		path,
	}));
	formData.set("files", JSON.stringify(parts));
	for (const [index, { file }] of selectedFiles.entries()) {
		formData.set(`file-${index}`, file, file.name);
	}

	return { formData, fileCount: selectedFiles.length, totalBytes };
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) {
		return `${Math.ceil(bytes / 1024)} KiB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const form = document.querySelector<HTMLFormElement>("#publish-form");
const publishSubmit =
	document.querySelector<HTMLButtonElement>("#publish-submit");
const htmlFileInput = document.querySelector<HTMLInputElement>("#site-file");
const folderInput = document.querySelector<HTMLInputElement>("#site-folder");
const ttlSelect = document.querySelector<HTMLSelectElement>("#publish-ttl");
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
let droppedFiles: UploadFile[] | null = null;
let dragDepth = 0;

function fileFromEntry(entry: DroppedFileEntry): Promise<File> {
	return new Promise((resolve, reject) => {
		entry.file(resolve, reject);
	});
}

function entriesFromReader(
	reader: DroppedDirectoryReader,
): Promise<DroppedEntry[]> {
	return new Promise((resolve, reject) => {
		const entries: DroppedEntry[] = [];
		const readBatch = () => {
			reader.readEntries((batch) => {
				if (batch.length === 0) {
					resolve(entries);
					return;
				}

				entries.push(...batch);
				readBatch();
			}, reject);
		};
		readBatch();
	});
}

async function filesFromEntry(
	entry: DroppedEntry,
	parentPath = "",
): Promise<UploadFile[]> {
	const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
	if (entry.isFile) {
		return [{ file: await fileFromEntry(entry), relativePath }];
	}

	const children = await entriesFromReader(entry.createReader());
	const nestedFiles = await Promise.all(
		children.map((child) => filesFromEntry(child, relativePath)),
	);
	return nestedFiles.flat();
}

async function filesFromDrop(
	dataTransfer: DataTransfer,
): Promise<UploadFile[]> {
	const items = Array.from(dataTransfer.items);
	const entries = items
		.filter((item) => item.kind === "file")
		.map(droppedEntry)
		.filter(
			(entry): entry is DroppedEntry => entry !== null && entry !== undefined,
		);

	if (entries.length > 0) {
		const files = await Promise.all(
			entries.map((entry) => filesFromEntry(entry)),
		);
		return files.flat();
	}

	return Array.from(dataTransfer.files, (file) => ({ file }));
}

function selectedFiles(): UploadFile[] {
	if (droppedFiles) {
		return droppedFiles;
	}

	if (htmlFileInput?.files && htmlFileInput.files.length > 0) {
		return Array.from(htmlFileInput.files, (file) => ({ file }));
	}

	return folderInput?.files
		? Array.from(folderInput.files, (file) => ({ file }))
		: [];
}

function setDragActive(active: boolean): void {
	if (form) {
		form.dataset.dragActive = active ? "true" : "false";
	}
}

function setPublishState(state: "invalid" | "ready" | "uploading"): void {
	if (form) {
		form.dataset.publishState = state;
	}

	for (const input of [htmlFileInput, folderInput]) {
		if (input) {
			input.disabled = state === "uploading";
		}
	}
	if (publishSubmit) {
		publishSubmit.disabled = state === "uploading";
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
	if (!htmlFileInput || !folderInput || !selectionSummary) {
		return null;
	}

	const prepared = prepareUpload(selectedFiles());
	if (typeof prepared === "string") {
		showClientValidation(prepared);
		if (selectionSummary) {
			selectionSummary.textContent = "No publish request is ready.";
		}
		setPublishState("invalid");
		return null;
	}

	showClientValidation(null);
	const fileLabel = prepared.fileCount === 1 ? "file" : "files";
	selectionSummary.textContent = `${prepared.fileCount} ${fileLabel}, ${formatBytes(prepared.totalBytes)} ready to publish.`;
	setPublishState("ready");
	return prepared;
}

htmlFileInput?.addEventListener("change", () => {
	droppedFiles = null;
	if (folderInput) {
		folderInput.value = "";
	}
	updateSelectionSummary();
});

folderInput?.addEventListener("change", () => {
	droppedFiles = null;
	if (htmlFileInput) {
		htmlFileInput.value = "";
	}
	updateSelectionSummary();
});

form?.addEventListener("dragenter", (event) => {
	if (form.dataset.publishState === "uploading") {
		return;
	}

	event.preventDefault();
	dragDepth += 1;
	setDragActive(true);
});

form?.addEventListener("dragover", (event) => {
	if (form.dataset.publishState === "uploading") {
		return;
	}

	event.preventDefault();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = "copy";
	}
});

form?.addEventListener("dragleave", (event) => {
	event.preventDefault();
	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) {
		setDragActive(false);
	}
});

form?.addEventListener("drop", async (event) => {
	event.preventDefault();
	dragDepth = 0;
	setDragActive(false);
	if (!event.dataTransfer || form.dataset.publishState === "uploading") {
		return;
	}

	try {
		if (htmlFileInput) {
			htmlFileInput.value = "";
		}
		if (folderInput) {
			folderInput.value = "";
		}
		droppedFiles = await filesFromDrop(event.dataTransfer);
		updateSelectionSummary();
	} catch {
		droppedFiles = null;
		showClientValidation(
			"The dropped file or folder could not be read. Choose an HTML file or folder instead.",
		);
		if (selectionSummary) {
			selectionSummary.textContent = "No publish request is ready.";
		}
		setPublishState("invalid");
	}
});

form?.addEventListener("submit", (event) => {
	event.preventDefault();
	const prepared = updateSelectionSummary();
	if (!prepared || !ttlSelect) {
		return;
	}
	prepared.formData.set("ttl", ttlSelect.value);

	form.setAttribute("aria-busy", "true");
	setPublishState("uploading");
	if (progress) {
		progress.value = 0;
	}
	if (progressStatus) {
		progressStatus.textContent = "Uploading 0%.";
	}

	const request = new XMLHttpRequest();
	request.open("POST", form.action);
	request.setRequestHeader("Accept", "text/html");
	request.setRequestHeader("X-Webdrop-Fragment", "publish");
	request.upload.addEventListener("progress", (progressEvent) => {
		if (!progressEvent.lengthComputable || progressEvent.total === 0) {
			return;
		}
		const percent = Math.min(
			100,
			Math.round((progressEvent.loaded / progressEvent.total) * 100),
		);
		if (progress) {
			progress.value = percent;
		}
		if (progressStatus) {
			progressStatus.textContent = `Uploading ${percent}%.`;
		}
	});
	const fail = () => {
		form.removeAttribute("aria-busy");
		setPublishState("ready");
		showClientValidation(
			"The upload failed. Check your connection and try again.",
		);
		if (progressStatus) {
			progressStatus.textContent = "Upload failed.";
		}
	};
	request.addEventListener("load", () => {
		const targetId =
			request.getResponseHeader("X-Webdrop-Target") === "publish-form"
				? "publish-form"
				: "publish-result";
		const target = document.getElementById(targetId);
		const template = document.createElement("template");
		template.innerHTML = request.responseText.trim();
		const replacement = template.content.firstElementChild;
		if (!target || !replacement) {
			fail();
			return;
		}
		target.replaceWith(replacement);
		if (targetId !== "publish-form") {
			form.removeAttribute("aria-busy");
			setPublishState("ready");
		}
	});
	request.addEventListener("error", fail);
	request.addEventListener("abort", fail);
	request.addEventListener("timeout", fail);
	request.send(prepared.formData);
});
