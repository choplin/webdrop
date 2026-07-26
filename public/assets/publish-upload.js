function hasControlCharacter(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
            return true;
        }
    }
    return false;
}
function isSafeDirectoryName(value) {
    return (value.length > 0 &&
        value !== "." &&
        value !== ".." &&
        !value.includes("\\") &&
        !hasControlCharacter(value));
}
export function selectedRelativePaths(files) {
    const selectedFiles = Array.from(files);
    const directoryPaths = selectedFiles.map((file) => file.webkitRelativePath ?? "");
    const hasDirectoryPath = directoryPaths.some((path) => path.length > 0);
    if (!hasDirectoryPath) {
        return { paths: selectedFiles.map((file) => file.name) };
    }
    if (directoryPaths.some((path) => path.length === 0)) {
        return {
            error: "The selected directory paths are inconsistent. Choose the directory again.",
        };
    }
    const splitPaths = directoryPaths.map((path) => path.split("/"));
    const selectedRoot = splitPaths[0]?.[0];
    if (selectedRoot === undefined ||
        !isSafeDirectoryName(selectedRoot) ||
        splitPaths.some((segments) => segments.length < 2 || segments[0] !== selectedRoot)) {
        return {
            error: "The selected directory paths are inconsistent. Choose the directory again.",
        };
    }
    return { paths: splitPaths.map((segments) => segments.slice(1).join("/")) };
}
export function setHtmxMultipartParameters(detail, parameters) {
    if (typeof detail !== "object" ||
        detail === null ||
        !("parameters" in detail)) {
        return false;
    }
    // htmx 2 exposes a formDataProxy here; it converts this FormData value itself.
    detail.parameters = parameters;
    return true;
}
