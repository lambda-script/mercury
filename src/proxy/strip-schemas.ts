/**
 * Token-saving transforms applied to MCP `tools/list` responses.
 *
 * `outputSchema` fields can be large and are not consumed by the LLM, so we strip them
 * before forwarding the list to the client.
 */

/**
 * Remove `outputSchema` from each tool in a `tools/list` response result.
 *
 * Returns the input unchanged if it does not look like a tools/list result
 * (no `tools` array, non-object value, etc.) so callers can apply this
 * defensively without pre-validating shape.
 *
 * @param result - The tools/list response `result` payload
 * @returns A new result with `outputSchema` removed from each tool, or the original
 *   value when nothing applies
 */
export function stripOutputSchemas(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;

  const obj = result as Record<string, unknown>;
  if (!Array.isArray(obj.tools)) return result;

  const strippedTools = obj.tools.map(stripToolOutputSchema);
  return { ...obj, tools: strippedTools };
}

function stripToolOutputSchema(tool: unknown): unknown {
  if (!tool || typeof tool !== "object") return tool;
  const toolObj = tool as Record<string, unknown>;
  if (!("outputSchema" in toolObj)) return tool;

  const rest: Record<string, unknown> = {};
  for (const key in toolObj) {
    if (key !== "outputSchema") rest[key] = toolObj[key];
  }
  return rest;
}
