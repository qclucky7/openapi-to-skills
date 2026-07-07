import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createRenderer,
	extractSchemaPrefix,
	TemplateRenderer,
	toFileName,
} from "./renderer.js";

// =============================================================================
// toFileName
// =============================================================================

describe("toFileName", () => {
	test("preserves case", () => {
		expect(toFileName("UserProfile")).toBe("UserProfile");
		expect(toFileName("GetCustomersCustomer")).toBe("GetCustomersCustomer");
	});

	test("replaces spaces with hyphens", () => {
		expect(toFileName("User Profile")).toBe("User-Profile");
	});

	test("removes special characters", () => {
		expect(toFileName("User@Profile!")).toBe("User-Profile");
	});

	test("collapses multiple hyphens", () => {
		expect(toFileName("User---Profile")).toBe("User-Profile");
	});

	test("trims leading and trailing hyphens", () => {
		expect(toFileName("--User--")).toBe("User");
	});

	test("handles mixed special characters", () => {
		expect(toFileName("My Awesome API!")).toBe("My-Awesome-API");
	});

	test("preserves Japanese characters", () => {
		expect(toFileName("ユーザー")).toBe("ユーザー");
		expect(toFileName("顧客管理")).toBe("顧客管理");
	});

	test("preserves mixed Japanese and English", () => {
		expect(toFileName("User-ユーザー")).toBe("User-ユーザー");
		expect(toFileName("顧客-Management")).toBe("顧客-Management");
	});

	test("replaces forbidden filesystem characters", () => {
		expect(toFileName("file:name")).toBe("file-name");
		expect(toFileName("file<>name")).toBe("file-name");
		expect(toFileName("file|name")).toBe("file-name");
		expect(toFileName('file"name')).toBe("file-name");
		expect(toFileName("file*name")).toBe("file-name");
		expect(toFileName("file?name")).toBe("file-name");
		expect(toFileName("file\\name")).toBe("file-name");
		expect(toFileName("file/name")).toBe("file-name");
	});

	test("normalizes Unicode to NFC", () => {
		const nfd = "\u30E6\u30FC\u30B5\u30FC".normalize("NFD");
		const nfc = "\u30E6\u30FC\u30B5\u30FC".normalize("NFC");
		expect(toFileName(nfd)).toBe(nfc);
	});

	test("handles control characters", () => {
		expect(toFileName("file\x00name")).toBe("file-name");
		expect(toFileName("file\x1Fname")).toBe("file-name");
	});

	test("preserves other Unicode scripts", () => {
		expect(toFileName("Файл")).toBe("Файл");
		expect(toFileName("文件")).toBe("文件");
		expect(toFileName("Ñoño")).toBe("Ñoño");
	});

	test("returns fallback for empty result", () => {
		expect(toFileName(":*?")).toBe("unnamed");
		expect(toFileName("///")).toBe("unnamed");
		expect(toFileName("   ")).toBe("unnamed");
	});
});

// =============================================================================
// extractSchemaPrefix
// =============================================================================

describe("extractSchemaPrefix", () => {
	test("extracts PascalCase prefix", () => {
		expect(extractSchemaPrefix("UserProfile")).toBe("User");
		expect(extractSchemaPrefix("UserInput")).toBe("User");
		expect(extractSchemaPrefix("User")).toBe("User");
	});

	test("extracts underscore prefix", () => {
		expect(extractSchemaPrefix("user_profile")).toBe("user");
		expect(extractSchemaPrefix("pet_status")).toBe("pet");
	});

	test("returns full name when no underscore", () => {
		// No PascalCase match + no underscore = entire string is the prefix
		expect(extractSchemaPrefix("123abc")).toBe("123abc");
		expect(extractSchemaPrefix("API")).toBe("API");
	});

	test("returns Other for empty string", () => {
		expect(extractSchemaPrefix("")).toBe("Other");
	});
});

// =============================================================================
// TemplateRenderer - constructor
// =============================================================================

describe("TemplateRenderer constructor", () => {
	test("throws when custom template dir not found", () => {
		expect(() => {
			new TemplateRenderer("/nonexistent/path");
		}).toThrow("Custom templates directory not found");
	});

	test("creates renderer with default templates", () => {
		const renderer = createRenderer();
		expect(renderer).toBeInstanceOf(TemplateRenderer);
	});
});

// =============================================================================
// TemplateRenderer - template fallback
// =============================================================================

describe("TemplateRenderer template fallback", () => {
	const testDir = join(import.meta.dir, "../.test-templates");

	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("uses custom template when exists", () => {
		// Create a custom skill template
		writeFileSync(join(testDir, "skill.md.eta"), "CUSTOM: <%= it.meta.name %>");

		const renderer = new TemplateRenderer(testDir);
		const result = renderer.renderSkill({
			meta: {
				name: "test-api",
				title: "Test",
				description: "",
				version: "1.0.0",
				openapiVersion: "3.0.0",
				servers: [],
				securitySchemes: [],
			},
			resources: [],
			schemaGroups: [],
			authSchemes: [],
		});

		expect(result).toBe("CUSTOM: test-api");
	});

	test("falls back to default when custom template missing", () => {
		// testDir exists but has no resource.md.eta
		const renderer = new TemplateRenderer(testDir);
		const result = renderer.renderResource({
			tag: "users",
			operations: [],
		});

		// Should use default template, which includes "# users"
		expect(result).toContain("# users");
	});
});

// =============================================================================
// TemplateRenderer - authentication
// =============================================================================

describe("TemplateRenderer - authentication", () => {
	test("renders apiKey header name when present", () => {
		const renderer = createRenderer();
		const result = renderer.renderAuthentication([
			{
				name: "ApiKeyAuth",
				type: "apiKey",
				in: "header",
				apiKeyName: "x-token",
				description: "API authentication token",
			},
		]);

		expect(result).toContain("## ApiKeyAuth");
		expect(result).toContain("**Type:** apiKey");
		expect(result).toContain("- **In:** header");
		expect(result).toContain("- **Name:** x-token");
	});
});

// =============================================================================
// TemplateRenderer - schema field defaults
// =============================================================================

describe("TemplateRenderer - schema field defaults", () => {
	test("renders default values by field type", () => {
		const renderer = createRenderer();
		const result = renderer.renderSchema({
			name: "BrowserSettings",
			type: "object",
			fields: [
				{
					name: "enable_browser_workbench_page",
					type: "boolean",
					required: false,
					defaultValue: true,
					description:
						"After turning it on, The browser will display the workbench page",
				},
				{ name: "kernel_version", type: "integer", required: false, defaultValue: 147 },
				{ name: "name", type: "string", required: false, defaultValue: "Chrome" },
				{
					name: "default_urls",
					type: "string[]",
					required: false,
					defaultValue: ["www.example.com"],
				},
			],
		});

		expect(result).toContain("| Field | Type | Required | Default | Description |");
		expect(result).toContain(
			"| `enable_browser_workbench_page` | boolean | No | `true` | After turning it on, The browser will display the workbench page |",
		);
		expect(result).toContain("| `kernel_version` | integer | No | `147` |  |");
		expect(result).toContain("| `name` | string | No | `Chrome` |  |");
		expect(result).toContain(
			"| `default_urls` | string[] | No | `[\"www.example.com\"]` |  |",
		);
	});
});

// =============================================================================
// TemplateRenderer - operation inline schemas (regression: inline bodies/
// responses were silently dropped because only schema.ref was rendered)
// =============================================================================

describe("TemplateRenderer - operation inline schemas", () => {
	const baseOp = {
		operationId: "mkdir",
		path: "/api/workspaces/{id}/agent/dirs",
		method: "POST",
		tag: "agent-files",
		deprecated: false,
		parameters: [],
		security: [],
	};

	test("renders inline object request body fields", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			requestBody: {
				required: true,
				contentTypes: ["application/json"],
				schema: {
					inline: {
						name: "(inline)",
						type: "object",
						fields: [
							{
								name: "path",
								type: "string",
								required: true,
								defaultValue: "/tmp",
								description: "Directory path to create",
							},
						],
					},
				},
			},
			responses: [],
		});

		expect(result).toContain("## Request Body");
		expect(result).toContain("**Schema** (inline):");
		expect(result).toContain("| Field | Type | Required | Default | Description |");
		expect(result).toContain(
			"| `path` | string | Yes | `/tmp` | Directory path to create |",
		);
	});

	test("renders inline object success response fields", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			responses: [
				{
					status: "200",
					description: "OK",
					schema: {
						inline: {
							name: "(inline)",
							type: "object",
							fields: [{ name: "ok", type: "boolean", required: true }],
						},
					},
				},
			],
		});

		expect(result).toContain("**Success Response Schema** (inline):");
		expect(result).toContain("| `ok` | boolean | Yes |  |  |");
	});

	test("links inline field that references a named schema", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			requestBody: {
				required: false,
				contentTypes: ["application/json"],
				schema: {
					inline: {
						name: "(inline)",
						type: "object",
						fields: [
							{
								name: "owner",
								type: "object",
								required: false,
								schema: { ref: "UserRef" },
							},
						],
					},
				},
			},
			responses: [],
		});

		expect(result).toContain("[UserRef](../schemas/User/UserRef.md)");
	});
});
