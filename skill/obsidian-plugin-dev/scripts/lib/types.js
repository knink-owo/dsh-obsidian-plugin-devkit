/**
 * Minimal structural types for the DeepSeek Harness host surface this bundle
 * uses. They are intentionally local (no runtime import of harness packages):
 * the bundle stays loadable across harness versions, and the shapes below are
 * the ones the host actually consumes when a plugin registers a tool.
 */
/** Wrap flat parameter definitions into an object-root JSON Schema. */
export function objectSchema(specs) {
    const properties = {};
    const required = [];
    for (const [name, spec] of Object.entries(specs)) {
        const { required: isRequired, ...schema } = spec;
        if (schema.items !== undefined && schema.items !== null) {
            const { required: _ignored, ...item } = schema.items;
            schema.items = item;
        }
        properties[name] = schema;
        if (isRequired === true)
            required.push(name);
    }
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
    };
}
//# sourceMappingURL=types.js.map