/**
 * Minimal structural types for the DeepSeek Harness host surface this bundle
 * uses. They are intentionally local (no runtime import of harness packages):
 * the bundle stays loadable across harness versions, and the shapes below are
 * the ones the host actually consumes when a plugin registers a tool.
 */

export type ToolParameterType = "string" | "number" | "boolean";

/** A single tool parameter in the harness' JSON-schema-flavoured DSL. */
export interface ToolParameter {
  type: ToolParameterType;
  /** Parameters are optional unless marked required. */
  required?: boolean;
  description?: string;
  /** Allowed values, when the parameter is an enumeration. */
  enum?: string[];
}

export type ToolParameters = Record<string, ToolParameter>;

export interface RenderedBlock {
  type: "text";
  text: string;
}

/** A string-valued tool result: the host renders it as one text block. */
export interface ToolOutput {
  schema: { type: "string" };
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
  parameters: ToolParameters;
  output: ToolOutput;
  execute(
    args: Record<string, unknown>,
    exec: ToolRunContext,
  ): Promise<string> | string;
  timeoutMs?: number;
  isConcurrencySafe?: boolean;
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
