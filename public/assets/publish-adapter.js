import { selectedRelativePaths, setHtmxMultipartParameters, } from "./publish-upload.js";
const maxFiles = 100;
const maxFileBytes = 10 * 1024 * 1024;
const maxTotalBytes = 50 * 1024 * 1024;
function droppedEntry(item) {
    const candidate = item;
    return candidate.webkitGetAsEntry?.call(item) ?? null;
}
function hasControlCharacter(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
            return true;
        }
    }
    return false;
}
function isSafeRelativePath(path) {
    if (path.length === 0 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        hasControlCharacter(path)) {
        return false;
    }
    const segments = path.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
        return false;
    }
    return !(path === "_meta" ||
        path.startsWith("_meta/") ||
        path === "sites" ||
        path.startsWith("sites/"));
}
function prepareUpload(selectedFiles) {
    if (selectedFiles.length === 0) {
        return "Choose a directory containing index.html.";
    }
    if (selectedFiles.length > maxFiles) {
        return "A publish can contain at most 100 files.";
    }
    const relativePaths = selectedRelativePaths(selectedFiles.map(({ file, relativePath }) => ({
        name: file.name,
        size: file.size,
        webkitRelativePath: file.webkitRelativePath,
        relativePath,
    })));
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
    for (const { file } of selectedFiles) {
        if (file.size > maxFileBytes) {
            return `${file.name} is larger than 10 MiB.`;
        }
        totalBytes += file.size;
        if (totalBytes > maxTotalBytes) {
            return "The selected directory is larger than 50 MiB.";
        }
    }
    const formData = new FormData();
    const parts = paths.map((path, index) => ({
        field: `file-${index}`,
        path,
    }));
    formData.set("files", JSON.stringify(parts));
    for (const [index, { file }] of selectedFiles.entries()) {
        formData.set(`file-${index}`, file, file.name);
    }
    return { formData, fileCount: selectedFiles.length, totalBytes };
}
function isHtmxProgressDetail(value) {
    return (typeof value === "object" &&
        value !== null &&
        "lengthComputable" in value &&
        "loaded" in value &&
        "total" in value &&
        typeof value.lengthComputable === "boolean" &&
        typeof value.loaded === "number" &&
        typeof value.total === "number");
}
function isHtmxBeforeSwapDetail(value) {
    return (typeof value === "object" &&
        value !== null &&
        "shouldSwap" in value &&
        "isError" in value &&
        "xhr" in value &&
        typeof value.shouldSwap === "boolean" &&
        typeof value.isError === "boolean" &&
        value.xhr instanceof XMLHttpRequest);
}
function formatBytes(bytes) {
    if (bytes < 1024 * 1024) {
        return `${Math.ceil(bytes / 1024)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
const form = document.querySelector("#publish-form");
const fileInput = document.querySelector("#site-files");
const clientValidation = document.querySelector("#publish-client-validation");
const selectionSummary = document.querySelector("#selection-summary");
const progress = document.querySelector("#publish-progress");
const progressStatus = document.querySelector("#publish-progress-status");
let droppedFiles = null;
let dragDepth = 0;
function fileFromEntry(entry) {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}
function entriesFromReader(reader) {
    return new Promise((resolve, reject) => {
        const entries = [];
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
async function filesFromEntry(entry, parentPath = "") {
    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
        return [{ file: await fileFromEntry(entry), relativePath }];
    }
    const children = await entriesFromReader(entry.createReader());
    const nestedFiles = await Promise.all(children.map((child) => filesFromEntry(child, relativePath)));
    return nestedFiles.flat();
}
async function filesFromDrop(dataTransfer) {
    const items = Array.from(dataTransfer.items);
    const entries = items
        .filter((item) => item.kind === "file")
        .map(droppedEntry)
        .filter((entry) => entry !== null && entry !== undefined);
    if (entries.length > 0) {
        const files = await Promise.all(entries.map((entry) => filesFromEntry(entry)));
        return files.flat();
    }
    return Array.from(dataTransfer.files, (file) => ({ file }));
}
function selectedFiles() {
    if (droppedFiles) {
        return droppedFiles;
    }
    return fileInput?.files
        ? Array.from(fileInput.files, (file) => ({ file }))
        : [];
}
function setDragActive(active) {
    if (form) {
        form.dataset.dragActive = active ? "true" : "false";
    }
}
function setPublishState(state) {
    if (form) {
        form.dataset.publishState = state;
    }
    if (fileInput) {
        fileInput.disabled = state === "uploading";
    }
}
function showClientValidation(message) {
    if (!clientValidation) {
        return;
    }
    clientValidation.hidden = message === null;
    clientValidation.textContent = message ?? "";
}
function updateSelectionSummary() {
    if (!fileInput || !selectionSummary) {
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
    selectionSummary.textContent = `${prepared.fileCount} files, ${formatBytes(prepared.totalBytes)} ready to publish.`;
    setPublishState("ready");
    return prepared;
}
fileInput?.addEventListener("change", () => {
    droppedFiles = null;
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
        droppedFiles = await filesFromDrop(event.dataTransfer);
        updateSelectionSummary();
    }
    catch {
        droppedFiles = null;
        showClientValidation("The dropped folder could not be read. Choose the directory instead.");
        if (selectionSummary) {
            selectionSummary.textContent = "No publish request is ready.";
        }
        setPublishState("invalid");
    }
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
        showClientValidation("The upload request could not be prepared. Try again.");
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
    if (!(event instanceof CustomEvent) ||
        !isHtmxProgressDetail(event.detail) ||
        !event.detail.lengthComputable ||
        event.detail.total === 0) {
        return;
    }
    const percent = Math.min(100, Math.round((event.detail.loaded / event.detail.total) * 100));
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
    if (!(event instanceof CustomEvent) ||
        !isHtmxBeforeSwapDetail(event.detail)) {
        return;
    }
    if (event.detail.xhr.status >= 400) {
        event.detail.shouldSwap = true;
        event.detail.isError = false;
    }
});
