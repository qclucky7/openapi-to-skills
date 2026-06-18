import { toFileName } from "./renderer.js";
import type {
	AuthSchemeDocument,
	FieldDocument,
	GroupByStrategy,
	OAuthFlowDocument,
	OpenAPISpec,
	OperationDocument,
	OperationObject,
	ParameterDocument,
	ParameterObject,
	ParserFilter,
	ParserOptions,
	ReferenceObject,
	RequestBodyDocument,
	RequestBodyObject,
	ResourceDocument,
	ResponseDocument,
	SchemaDocument,
	SchemaGroupDocument,
	SchemaObject,
	SchemaRefDocument,
	SecurityRequirementDocument,
	SkillDocument,
	SkillMeta,
} from "./types.js";
import { isReferenceObject } from "./types.js";

const HTTP_METHODS = [
	"get",
	"put",
	"post",
	"delete",
	"options",
	"head",
	"patch",
	"trace",
] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

// =============================================================================
// Parser Class
// =============================================================================

export class Parser {
	private schemas?: Record<string, SchemaObject | ReferenceObject>;

	parse(spec: OpenAPISpec, options: ParserOptions = {}): SkillDocument {
		this.schemas = spec.components?.schemas ?? {};
		const filter = options.filter ?? {};
		const groupBy = options.groupBy ?? "auto";

		// Parse meta
		const meta = this.parseMeta(spec, options.skillName);

		// Parse resources (operations grouped by tag or path)
		const resources = this.parseResources(spec, filter, groupBy);

		// Parse schema groups
		const schemaGroups = this.parseSchemaGroups(spec);

		// Parse auth schemes
		const authSchemes = this.parseAuthSchemes(spec);

		this.schemas = undefined;

		return {
			meta,
			resources,
			schemaGroups,
			authSchemes,
		};
	}

	private parseMeta(spec: OpenAPISpec, skillName?: string): SkillMeta {
		const description = spec.info.description ?? "";

		return {
			name: skillName ?? this.toSkillName(spec.info.title),
			title: spec.info.title,
			description,
			version: spec.info.version,
			openapiVersion: spec.openapi,
			license: spec.info.license
				? { name: spec.info.license.name, url: spec.info.license.url }
				: undefined,
			contact: spec.info.contact?.email,
			servers: (spec.servers ?? []).map((s) => ({
				url: s.url,
				description: s.description,
			})),
			securitySchemes: spec.components?.securitySchemes
				? Object.keys(spec.components.securitySchemes)
				: [],
		};
	}

	private parseResources(
		spec: OpenAPISpec,
		filter: ParserFilter,
		groupBy: GroupByStrategy,
	): ResourceDocument[] {
		const tagDescriptions = new Map<string, string>();
		if (spec.tags) {
			for (const tag of spec.tags) {
				tagDescriptions.set(tag.name, tag.description ?? "");
			}
		}

		const resourceMap = new Map<string, ResourceDocument>();

		for (const [path, pathItem] of Object.entries(spec.paths)) {
			if (!pathItem) continue;

			// Check path exclusion
			if (this.isPathExcluded(path, filter)) continue;

			for (const method of HTTP_METHODS) {
				const operation = pathItem[method] as OperationObject | undefined;
				if (!operation) continue;

				// Check deprecated exclusion
				if (filter.excludeDeprecated && operation.deprecated) continue;

				// Determine resource name(s) based on groupBy strategy
				const resourceNames = this.getResourceNames(path, operation, groupBy);

				for (const resourceName of resourceNames) {
					// Check tag inclusion/exclusion (applies to resource names)
					if (!this.isTagIncluded(resourceName, filter)) continue;

					if (!resourceMap.has(resourceName)) {
						resourceMap.set(resourceName, {
							tag: resourceName,
							description: tagDescriptions.get(resourceName),
							operations: [],
						});
					}

					const opDoc = this.parseOperation(
						path,
						method,
						operation,
						resourceName,
					);
					resourceMap.get(resourceName)?.operations.push(opDoc);
				}
			}
		}

		// Sort by operation count descending
		return [...resourceMap.values()].sort(
			(a, b) => b.operations.length - a.operations.length,
		);
	}

	private getResourceNames(
		path: string,
		operation: OperationObject,
		groupBy: GroupByStrategy,
	): string[] {
		switch (groupBy) {
			case "tags":
				return operation.tags ?? ["default"];

			case "path":
				return [this.extractResourceFromPath(path)];

			case "auto": {
				// Use tags if available, otherwise use path
				if (operation.tags && operation.tags.length > 0) {
					return operation.tags;
				}
				return [this.extractResourceFromPath(path)];
			}
		}
	}

	/**
	 * Extract resource name from path by taking the first segment
	 * after stripping common version prefixes.
	 *
	 * Examples:
	 * - /v1/accounts/{id} -> accounts
	 * - /api/v2/users -> users
	 * - /customers/{id}/orders -> customers
	 */
	private extractResourceFromPath(path: string): string {
		// Strip common version prefixes
		const stripped = path.replace(/^\/(api\/)?(v\d+\/)?/i, "/");

		// Get first path segment
		const segments = stripped.split("/").filter(Boolean);
		const firstSegment = segments[0];

		if (!firstSegment) {
			return "default";
		}

		// Remove path parameters (e.g., {id})
		if (firstSegment.startsWith("{")) {
			return "default";
		}

		return firstSegment;
	}

	private parseOperation(
		path: string,
		method: HttpMethod,
		operation: OperationObject,
		tag: string,
	): OperationDocument {
		return {
			operationId:
				operation.operationId ?? `${method}-${path.replace(/\//g, "-")}`,
			path,
			method: method.toUpperCase(),
			tag,
			summary: operation.summary,
			description: operation.description,
			deprecated: operation.deprecated ?? false,
			parameters: this.parseParameters(operation.parameters ?? []),
			requestBody: operation.requestBody
				? this.parseRequestBody(operation.requestBody)
				: undefined,
			responses: this.parseResponses(operation.responses ?? {}),
			security: this.parseSecurity(operation.security ?? []),
		};
	}

	private parseParameters(
		params: (ParameterObject | ReferenceObject)[],
	): ParameterDocument[] {
		return params
			.filter((p): p is ParameterObject => !isReferenceObject(p))
			.map((p) => ({
				name: p.name,
				in: p.in as ParameterDocument["in"],
				type: this.getSchemaType(p.schema),
				required: p.required ?? false,
				description: p.description,
				schema: p.schema ? this.parseSchemaRef(p.schema) : undefined,
			}));
	}

	private parseRequestBody(
		reqBody: RequestBodyObject | ReferenceObject,
	): RequestBodyDocument | undefined {
		if (isReferenceObject(reqBody)) return undefined;

		const contentTypes = Object.keys(reqBody.content);
		const firstContentType = contentTypes[0];
		const firstContent = firstContentType
			? reqBody.content[firstContentType]
			: undefined;

		return {
			description: reqBody.description,
			required: reqBody.required ?? false,
			contentTypes,
			schema: firstContent?.schema
				? this.parseSchemaRef(firstContent.schema)
				: undefined,
		};
	}

	private parseResponses(
		responses: Record<string, unknown>,
	): ResponseDocument[] {
		const result: ResponseDocument[] = [];

		for (const [status, response] of Object.entries(responses)) {
			if (isReferenceObject(response)) {
				result.push({ status, description: "(reference)" });
				continue;
			}

			const res = response as {
				description?: string;
				content?: Record<string, { schema?: unknown }>;
			};
			const content = res.content?.["application/json"];

			result.push({
				status,
				description: res.description ?? "",
				schema: content?.schema
					? this.parseSchemaRef(
							content.schema as SchemaObject | ReferenceObject,
						)
					: undefined,
			});
		}

		return result;
	}

	private parseSecurity(
		security: Array<Record<string, string[]>>,
	): SecurityRequirementDocument[] {
		const result: SecurityRequirementDocument[] = [];

		for (const req of security) {
			for (const [name, scopes] of Object.entries(req)) {
				result.push({ name, scopes });
			}
		}

		return result;
	}

	private parseSchemaGroups(spec: OpenAPISpec): SchemaGroupDocument[] {
		const schemas = spec.components?.schemas;
		if (!schemas) return [];

		const groups = new Map<string, SchemaGroupDocument>();

		for (const [name, schema] of Object.entries(schemas)) {
			const prefix = this.extractSchemaPrefix(name);

			if (!groups.has(prefix)) {
				groups.set(prefix, { prefix, schemas: [] });
			}

			groups.get(prefix)?.schemas.push(this.parseSchema(name, schema));
		}

		return [...groups.values()];
	}

	private parseSchema(
		name: string,
		schema: SchemaObject | ReferenceObject,
	): SchemaDocument {
		if (isReferenceObject(schema)) {
			return { name, type: "object", description: `Reference: ${schema.$ref}` };
		}

		const schemaType = this.getSchemaDocType(schema);

		const doc: SchemaDocument = {
			name,
			type: schemaType,
			description: schema.description,
		};

		if (schemaType === "object" && schema.properties) {
			doc.fields = this.parseFields(schema, new Set<string>());
			doc.example = this.generateExample(schema, new Set<string>());
		} else if (schemaType === "enum" && schema.enum) {
			doc.enumValues = schema.enum;
		} else if (schemaType === "array" && "items" in schema && schema.items) {
			doc.items = this.parseSchemaRef(schema.items);
		} else if (
			schemaType === "allOf" ||
			schemaType === "oneOf" ||
			schemaType === "anyOf"
		) {
			const composite = schema.allOf ?? schema.oneOf ?? schema.anyOf;
			doc.composition = composite?.map((item) => this.parseSchemaRef(item));
		}

		return doc;
	}

	private parseFields(
		schema: SchemaObject,
		visited: Set<string>,
	): FieldDocument[] {
		const required = new Set(schema.required ?? []);
		const fields: FieldDocument[] = [];

		for (const [propName, propSchema] of Object.entries(
			schema.properties ?? {},
		)) {
			fields.push(
				this.parseField(propName, propSchema, required.has(propName), visited),
			);
		}

		return fields;
	}

	private parseField(
		name: string,
		schema: SchemaObject | ReferenceObject,
		isRequired: boolean,
		visited: Set<string>,
	): FieldDocument {
		const field: FieldDocument = {
			name,
			type: this.getSchemaType(schema),
			required: isRequired,
		};

		if (isReferenceObject(schema)) {
			field.schema = { ref: this.getRefName(schema.$ref) };
			// Resolve $ref to show nested fields inline
			if (this.schemas && visited.size < 3) {
				const refName = this.getRefName(schema.$ref);
				if (!visited.has(refName)) {
					const resolved = this.schemas[refName];
					if (
						resolved &&
						!isReferenceObject(resolved) &&
						resolved.type === "object" &&
						resolved.properties
					) {
						const nestedVisited = new Set(visited);
						nestedVisited.add(refName);
						field.nestedFields = this.parseFields(resolved, nestedVisited);
					}
				}
			}
		} else {
			field.description = schema.description;

			// Handle nested inline objects
			if (schema.type === "object" && schema.properties) {
				field.nestedFields = this.parseFields(schema, visited);
			}

			// Handle array of inline objects or $ref items
			if (schema.type === "array" && "items" in schema && schema.items) {
				if (isReferenceObject(schema.items)) {
					const refName = this.getRefName(schema.items.$ref);
					if (this.schemas && visited.size < 3 && !visited.has(refName)) {
						const resolved = this.schemas[refName];
						if (
							resolved &&
							!isReferenceObject(resolved) &&
							resolved.type === "object" &&
							resolved.properties
						) {
							const nestedVisited = new Set(visited);
							nestedVisited.add(refName);
							field.nestedFields = this.parseFields(resolved, nestedVisited);
						}
					}
				} else {
					const items = schema.items as SchemaObject;
					if (items.type === "object" && items.properties) {
						field.nestedFields = this.parseFields(items, visited);
					}
				}
			}

			// Handle allOf/oneOf/anyOf composition in fields
			const composite = schema.allOf ?? schema.oneOf ?? schema.anyOf;
			if (composite) {
				const refItem = composite.find((item) => isReferenceObject(item));
				if (refItem && isReferenceObject(refItem)) {
					const refName = this.getRefName(refItem.$ref);
					field.schema = { ref: refName };
					if (this.schemas && visited.size < 3 && !visited.has(refName)) {
						const resolved = this.schemas[refName];
						if (
							resolved &&
							!isReferenceObject(resolved) &&
							resolved.properties
						) {
							const nestedVisited = new Set(visited);
							nestedVisited.add(refName);
							field.nestedFields = this.parseFields(resolved, nestedVisited);
						}
					}
				}
			}
		}

		return field;
	}

	private generateExample(schema: SchemaObject, visited: Set<string>): unknown {
		if (schema.properties) {
			const obj: Record<string, unknown> = {};
			for (const [propName, propSchema] of Object.entries(schema.properties)) {
				obj[propName] = this.generateFieldExample(propSchema, visited);
			}
			return obj;
		}
		return {};
	}

	private generateFieldExample(
		schema: SchemaObject | ReferenceObject,
		visited: Set<string>,
	): unknown {
		if (isReferenceObject(schema)) {
			const refName = this.getRefName(schema.$ref);
			if (visited.has(refName)) return { "…": "circular" };
			if (this.schemas) {
				const resolved = this.schemas[refName];
				if (resolved && !isReferenceObject(resolved)) {
					visited.add(refName);
					return this.generateExample(resolved, visited);
				}
			}
			return {};
		}

		if (schema.example !== undefined) return schema.example;

		const examples = (schema as Record<string, unknown>).examples;
		if (Array.isArray(examples) && examples.length > 0) return examples[0];

		if (schema.enum && schema.enum.length > 0) return schema.enum[0];

		// Handle allOf/oneOf/anyOf composition
		const composite = schema.allOf ?? schema.oneOf ?? schema.anyOf;
		if (composite) {
			const refItem = composite.find((item) => isReferenceObject(item));
			if (refItem && isReferenceObject(refItem)) {
				const refName = this.getRefName(refItem.$ref);
				if (!visited.has(refName) && this.schemas) {
					const resolved = this.schemas[refName];
					if (resolved && !isReferenceObject(resolved)) {
						visited.add(refName);
						return this.generateExample(resolved, visited);
					}
				}
			}
			return {};
		}

		switch (schema.type) {
			case "string":
				return schema.format === "date-time"
					? "2019-08-24T14:15:22Z"
					: "string";
			case "integer":
				return 0;
			case "number":
				return 0.0;
			case "boolean":
				return true;
			case "array":
				if (schema.items) {
					const itemExample = this.generateFieldExample(schema.items, visited);
					return [itemExample];
				}
				return [];
			case "object":
				return this.generateExample(schema, visited);
			default:
				return "";
		}
	}

	private parseSchemaRef(
		schema: SchemaObject | ReferenceObject,
	): SchemaRefDocument {
		if (isReferenceObject(schema)) {
			return { ref: this.getRefName(schema.$ref) };
		}

		if (schema.type === "array" && schema.items) {
			if (isReferenceObject(schema.items)) {
				return { ref: `${this.getRefName(schema.items.$ref)}[]` };
			}
		}

		return { inline: this.parseSchema("(inline)", schema) };
	}

	private parseAuthSchemes(spec: OpenAPISpec): AuthSchemeDocument[] {
		const securitySchemes = spec.components?.securitySchemes;
		if (!securitySchemes) {
			return [];
		}

		const schemes: AuthSchemeDocument[] = [];

		for (const [name, scheme] of Object.entries(securitySchemes)) {
			if (isReferenceObject(scheme)) continue;

			const schemeDoc: AuthSchemeDocument = {
				name,
				type: scheme.type,
				description: scheme.description,
			};

			if (scheme.type === "apiKey") {
				schemeDoc.in = scheme.in;
				schemeDoc.apiKeyName = scheme.name;
			} else if (scheme.type === "http") {
				schemeDoc.scheme = scheme.scheme;
				schemeDoc.bearerFormat = scheme.bearerFormat;
			} else if (scheme.type === "oauth2") {
				schemeDoc.flows = this.parseOAuthFlows(
					scheme.flows as Record<string, unknown>,
				);
			} else if (scheme.type === "openIdConnect") {
				schemeDoc.openIdConnectUrl = scheme.openIdConnectUrl;
			}

			schemes.push(schemeDoc);
		}

		return schemes;
	}

	private parseOAuthFlows(
		flows: Record<string, unknown> | undefined,
	): OAuthFlowDocument[] {
		if (!flows) return [];

		const result: OAuthFlowDocument[] = [];

		for (const [flowName, flow] of Object.entries(flows)) {
			if (!flow || typeof flow !== "object") continue;

			const f = flow as Record<string, unknown>;
			result.push({
				name: flowName,
				authorizationUrl:
					typeof f.authorizationUrl === "string"
						? f.authorizationUrl
						: undefined,
				tokenUrl: typeof f.tokenUrl === "string" ? f.tokenUrl : undefined,
				scopes: (f.scopes as Record<string, string>) ?? {},
			});
		}

		return result;
	}

	// ===========================================================================
	// Filter helpers
	// ===========================================================================

	private isPathExcluded(path: string, filter: ParserFilter): boolean {
		if (!filter.excludePaths) return false;

		return filter.excludePaths.some((pattern) => {
			if (typeof pattern === "string") {
				return path === pattern || path.startsWith(pattern);
			}
			return pattern.test(path);
		});
	}

	private isTagIncluded(tag: string, filter: ParserFilter): boolean {
		if (filter.includeTags && filter.includeTags.length > 0) {
			return filter.includeTags.includes(tag);
		}

		if (filter.excludeTags && filter.excludeTags.length > 0) {
			return !filter.excludeTags.includes(tag);
		}

		return true;
	}

	// ===========================================================================
	// Utility helpers
	// ===========================================================================

	private toSkillName(name: string): string {
		return toFileName(name).toLowerCase().substring(0, 64);
	}

	private getRefName(ref: string): string {
		const parts = ref.split("/");
		return parts[parts.length - 1] ?? ref;
	}

	private extractSchemaPrefix(name: string): string {
		const match = name.match(/^([A-Z][a-z]+)/);
		if (match?.[1]) return match[1];

		const underscoreMatch = name.match(/^([^_]+)/);
		if (underscoreMatch?.[1]) return underscoreMatch[1];

		return "Other";
	}

	private getSchemaType(schema: unknown): string {
		if (!schema) return "any";
		if (isReferenceObject(schema)) {
			return this.getRefName(schema.$ref);
		}

		const s = schema as SchemaObject;

		if (s.enum) {
			return `enum: ${s.enum.slice(0, 3).join(", ")}${s.enum.length > 3 ? "..." : ""}`;
		}

		if (s.type === "array" && s.items) {
			if (isReferenceObject(s.items)) {
				return `${this.getRefName(s.items.$ref)}[]`;
			}
			return `${(s.items as SchemaObject).type ?? "any"}[]`;
		}

		// Handle allOf/oneOf/anyOf at field level
		const composite = s.allOf ?? s.oneOf ?? s.anyOf;
		if (composite) {
			const refItem = composite.find((item) => isReferenceObject(item));
			if (refItem && isReferenceObject(refItem)) {
				return this.getRefName(refItem.$ref);
			}
		}

		let type = s.type ?? "any";
		if (s.format) {
			type += ` (${s.format})`;
		}

		return type;
	}

	private getSchemaDocType(schema: SchemaObject): SchemaDocument["type"] {
		if (schema.enum) return "enum";
		if (schema.allOf) return "allOf";
		if (schema.oneOf) return "oneOf";
		if (schema.anyOf) return "anyOf";
		if (schema.type === "array") return "array";
		if (schema.type === "object" || schema.properties) return "object";
		return "primitive";
	}
}

/**
 * Create a parser instance
 */
export function createParser(): Parser {
	return new Parser();
}
