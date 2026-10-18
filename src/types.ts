/**
 * Minimal structural types for the DeepSeek Harness host surface this bundle
 * uses. They are intentionally local (no runtime import of harness packages):
 * the bundle stays loadable across harness versions, and the shapes below are
 * the ones the host actually consumes when a plugin registers a tool.
 */

export type JsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

/**
 * The JSON Schema subset the harness validates tool schemas against.
 *
 * A registered tool's `parameters` is a JSON Schema *object root* (the model
 * API rejects anything whose top level is not `type: "object"`). The harness
 * passes it to the model as the function's parameter schema, so a flat
 * `{ name: { type: "string" } }` map — the shape the harness' own `defineTool`
 * helper accepts — must be wrapped first; see {@link objectSchema}.
 */
export interface JsonSchemaNode {
  type?: JsonSchemaType;
  oneOf?: JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  enum?: (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  description?: string;
  title?: string;
  default?: unknown;
  examples?: unknown;
}

/** One parameter of an {@link objectSchema} definition. */
export interface ParameterSpec extends Omit<JsonSchemaNode, "required"> {
  /** `objectSchema` moves this flag into the root `required` array. */
  required?: boolean;
}

/** Wrap flat parameter definitions into an object-root JSON Schema. */
export function objectSchema(
  specs: Record<string, ParameterSpec>,
): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    const { required: isRequired, ...schema } = spec;
    if (schema.items !== undefined && schema.items !== null) {
      const { required: _ignored, ...item } = schema.items as ParameterSpec;
      schema.items = item;
    }
    properties[name] = schema;
    if (isRequired === true) required.push(name);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export interface RenderedBlock {
  type: "text";
  text: string;
}

/** A string-valued tool result: the host renders it as one text block. */
export interface ToolOutput {
  schema: JsonSchemaNode;
  render(args: unknown, value: string): RenderedBlock[];
}

export interface ToolRunContext {
  signal?: AbortSignal;
  agent?: {
    session?: {
      id?: string;
      header?: { cwd?: string };
    };
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object root, projected to the model exactly as written. */
  parameters: JsonSchemaNode;
  output: ToolOutput;
  execute(
    args: Record<string, unknown>,
    exec: ToolRunContext,
  ): Promise<string> | string;
  timeoutMs?: number;
  isConcurrencySafe?(args: unknown): boolean;
}

/** A sandbox execution policy, as resolved by the host's sandbox policy service. */
export interface SandboxPolicy {
  mode?: "read-only" | "workspace-write" | "danger-full-access";
  workspaceRoot?: string;
  [key: string]: unknown;
}

/** Per-call context handed to the filesystem layer. */
export interface FsCall {
  workspaceRoot?: string;
  policy?: SandboxPolicy;
  signal?: AbortSignal;
}

/** The subset of `ctx` this plugin relies on. */
export interface DevkitContext {
  tools: { register(definition: ToolDefinition): void };
  fs?: unknown;
  get?: (service: string) => unknown;
  logger?: { warn?(message: string): void };
}
