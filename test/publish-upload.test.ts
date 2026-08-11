import { describe, expect, it } from "vitest";
import { selectedRelativePaths } from "../client/publish-upload";

describe("browser publish upload preparation", () => {
	it("strips exactly one shared selected-directory root", () => {
		expect(
			selectedRelativePaths([
				{
					name: "index.html",
					size: 10,
					webkitRelativePath: "site/index.html",
				},
				{
					name: "app.js",
					size: 20,
					webkitRelativePath: "site/assets/app.js",
				},
			]),
		).toEqual({ paths: ["index.html", "assets/app.js"] });
	});

	it("rejects directory paths with different selected roots", () => {
		expect(
			selectedRelativePaths([
				{
					name: "index.html",
					size: 10,
					webkitRelativePath: "site-a/index.html",
				},
				{
					name: "app.js",
					size: 20,
					webkitRelativePath: "site-b/assets/app.js",
				},
			]),
		).toEqual({
			error:
				"The selected folder paths are inconsistent. Choose the folder again.",
		});
	});

	it("rejects a mix of directory and fallback file paths", () => {
		expect(
			selectedRelativePaths([
				{
					name: "index.html",
					size: 10,
					webkitRelativePath: "site/index.html",
				},
				{ name: "app.js", size: 20 },
			]),
		).toEqual({
			error:
				"The selected folder paths are inconsistent. Choose the folder again.",
		});
	});

	it("uses file names when the browser does not provide directory paths", () => {
		expect(
			selectedRelativePaths([
				{ name: "index.html", size: 10 },
				{ name: "app.js", size: 20 },
			]),
		).toEqual({ paths: ["index.html", "app.js"] });
	});

	it("publishes one dropped HTML file as the root index", () => {
		expect(
			selectedRelativePaths([
				{
					name: "standalone.html",
					size: 10,
					relativePath: "standalone.html",
				},
			]),
		).toEqual({ paths: ["index.html"] });
	});

	it("uses explicit relative paths collected from a dropped directory", () => {
		expect(
			selectedRelativePaths([
				{
					name: "index.html",
					size: 10,
					relativePath: "site/index.html",
				},
				{
					name: "app.js",
					size: 20,
					relativePath: "site/assets/app.js",
				},
			]),
		).toEqual({ paths: ["index.html", "assets/app.js"] });
	});
});
