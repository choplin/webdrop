import { describe, expect, it } from "vitest";
import {
	selectedRelativePaths,
	setHtmxMultipartParameters,
} from "../client/publish-upload";

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
				"The selected directory paths are inconsistent. Choose the directory again.",
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
				"The selected directory paths are inconsistent. Choose the directory again.",
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

	it("replaces htmx's formDataProxy parameters with multipart FormData", () => {
		const detail: { parameters: unknown } = { parameters: { proxy: true } };
		const formData = new FormData();
		formData.set("files", "[]");

		expect(setHtmxMultipartParameters(detail, formData)).toBe(true);
		expect(detail.parameters).toBe(formData);
	});
});
