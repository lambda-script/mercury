import { describe, it, expect } from "vitest";
import { stripOutputSchemas } from "../../src/proxy/strip-schemas.js";

describe("stripOutputSchemas", () => {
  it("removes outputSchema from each tool while preserving other fields", () => {
    const result = {
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { content: { type: "string" } } },
        },
        {
          name: "write_file",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      ],
    };

    const stripped = stripOutputSchemas(result) as { tools: Record<string, unknown>[] };

    expect(stripped.tools).toHaveLength(2);
    expect(stripped.tools[0]).not.toHaveProperty("outputSchema");
    expect(stripped.tools[0]).toMatchObject({
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object" },
    });
    expect(stripped.tools[1]).not.toHaveProperty("outputSchema");
    expect(stripped.tools[1]).toMatchObject({ name: "write_file" });
  });

  it("does not mutate the input result", () => {
    const result = {
      tools: [{ name: "tool", outputSchema: { type: "object" } }],
    };

    const stripped = stripOutputSchemas(result) as { tools: Record<string, unknown>[] };

    expect(result.tools[0]).toHaveProperty("outputSchema");
    expect(stripped.tools[0]).not.toHaveProperty("outputSchema");
    expect(stripped).not.toBe(result);
  });

  it("preserves other fields on the result object", () => {
    const result = {
      tools: [{ name: "tool" }],
      nextCursor: "abc",
      _meta: { x: 1 },
    };

    const stripped = stripOutputSchemas(result);
    expect(stripped).toMatchObject({ nextCursor: "abc", _meta: { x: 1 } });
  });

  it("returns input unchanged when tools is missing or not an array", () => {
    const noTools = { someField: "value" };
    expect(stripOutputSchemas(noTools)).toBe(noTools);

    const wrongShape = { tools: "not an array" };
    expect(stripOutputSchemas(wrongShape)).toBe(wrongShape);
  });

  it("returns input unchanged for non-object values", () => {
    expect(stripOutputSchemas(null)).toBeNull();
    expect(stripOutputSchemas(undefined)).toBeUndefined();
    expect(stripOutputSchemas("string")).toBe("string");
    expect(stripOutputSchemas(42)).toBe(42);
  });

  it("passes through tool entries that are not objects", () => {
    const result = { tools: [null, "string", 1, { name: "real", outputSchema: {} }] };
    const stripped = stripOutputSchemas(result) as { tools: unknown[] };
    expect(stripped.tools[0]).toBeNull();
    expect(stripped.tools[1]).toBe("string");
    expect(stripped.tools[2]).toBe(1);
    expect(stripped.tools[3]).toEqual({ name: "real" });
  });

  it("returns the same tool object when no outputSchema is present", () => {
    const tool = { name: "lean", inputSchema: { type: "object" } };
    const result = { tools: [tool] };
    const stripped = stripOutputSchemas(result) as { tools: unknown[] };
    // No allocation needed for tools that don't have outputSchema
    expect(stripped.tools[0]).toBe(tool);
  });
});
