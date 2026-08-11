export interface SelectedFile {
	name: string;
	size: number;
	webkitRelativePath?: string;
	relativePath?: string;
}

export type RelativePathResult = { paths: string[] } | { error: string };

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true;
		}
	}

	return false;
}

function isSafeDirectoryName(value: string): boolean {
	return (
		value.length > 0 &&
		value !== "." &&
		value !== ".." &&
		!value.includes("\\") &&
		!hasControlCharacter(value)
	);
}

export function selectedRelativePaths(
	files: Iterable<SelectedFile>,
): RelativePathResult {
	const selectedFiles = Array.from(files);
	const directoryPaths = selectedFiles.map(
		(file) => file.relativePath ?? file.webkitRelativePath ?? "",
	);
	const hasDirectoryPath = directoryPaths.some((path) => path.length > 0);

	if (!hasDirectoryPath) {
		if (
			selectedFiles.length === 1 &&
			/\.html?$/i.test(selectedFiles[0]?.name ?? "")
		) {
			return { paths: ["index.html"] };
		}

		return { paths: selectedFiles.map((file) => file.name) };
	}

	if (
		selectedFiles.length === 1 &&
		directoryPaths[0] !== undefined &&
		!directoryPaths[0].includes("/") &&
		/\.html?$/i.test(selectedFiles[0]?.name ?? "")
	) {
		return { paths: ["index.html"] };
	}

	if (directoryPaths.some((path) => path.length === 0)) {
		return {
			error:
				"The selected folder paths are inconsistent. Choose the folder again.",
		};
	}

	const splitPaths = directoryPaths.map((path) => path.split("/"));
	const selectedRoot = splitPaths[0]?.[0];
	if (
		selectedRoot === undefined ||
		!isSafeDirectoryName(selectedRoot) ||
		splitPaths.some(
			(segments) => segments.length < 2 || segments[0] !== selectedRoot,
		)
	) {
		return {
			error:
				"The selected folder paths are inconsistent. Choose the folder again.",
		};
	}

	return { paths: splitPaths.map((segments) => segments.slice(1).join("/")) };
}
