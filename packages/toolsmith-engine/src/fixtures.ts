import type { ToolSpec, ToolSurface } from "@alexvegman/toolsmith-core";

const ZERO_TOKENS = { name: 0, description: 0, schema: 0, total: 0 };

function provenance(): ToolSpec["provenance"] {
  return { adapter: "fixture", confidence: 1, editable: false };
}

/**
 * A surface with no defects any rule in this slice checks for. Used to
 * assert zero findings — catches over-firing.
 */
export function cleanSurface(): ToolSurface {
  const tools: ToolSpec[] = [
    {
      id: "tool-1",
      name: "get_weather",
      description: "Gets the current weather for a location.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          units: { type: "array", items: { type: "string" } },
        },
        required: ["location"],
        additionalProperties: false,
      },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      id: "tool-2",
      name: "list_events",
      description: "Lists calendar events in a date range.",
      inputSchema: {
        type: "object",
        properties: {
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["startDate", "endDate"],
        additionalProperties: false,
      },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
  ];

  return { id: "surface-clean", tools, provider: "generic" };
}

/**
 * A surface with exactly one defect per rule under test, each traceable to
 * a specific tool id. Used to assert every targeted rule fires exactly
 * once — catches under-firing.
 */
export function dirtySurface(): ToolSurface {
  const tools: ToolSpec[] = [
    {
      // NAM-001: empty name
      id: "nam001-tool",
      name: "",
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // NAM-002: illegal characters
      id: "nam002-tool",
      name: "get user!",
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // NAM-003: too long (70 chars). Per §9.1's own detection column,
      // NAM-002's charset regex bakes in the same {1,64} length bound, so
      // this also legitimately trips NAM-002 — that overlap is inherent
      // to the spec, not a fixture defect (see extraOverlap in the test).
      id: "nam003-tool",
      name: "a".repeat(70),
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // NAM-004: exact duplicate name (paired with nam004-tool-b below)
      id: "nam004-tool-a",
      name: "duplicate_name",
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      id: "nam004-tool-b",
      name: "duplicate_name",
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // NAM-005: case/separator near-duplicate (paired with nam005-tool-b)
      id: "nam005-tool-a",
      name: "get_user",
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      id: "nam005-tool-b",
      name: "getUser",
      description: "d",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-001: root not object
      id: "sch001-tool",
      name: "sch001_tool",
      description: "d",
      inputSchema: { type: "string" },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-003: object type, no properties
      id: "sch003-tool",
      name: "sch003_tool",
      description: "d",
      inputSchema: { type: "object" },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-005: has properties, no required
      id: "sch005-tool",
      name: "sch005_tool",
      description: "d",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-006: required lists an unknown key
      id: "sch006-tool",
      name: "sch006_tool",
      description: "d",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name", "ghost"],
        additionalProperties: false,
      },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-007: additionalProperties not false
      id: "sch007-tool",
      name: "sch007_tool",
      description: "d",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-008: empty schema
      id: "sch008-tool",
      name: "sch008_tool",
      description: "d",
      inputSchema: {},
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
    {
      // SCH-021: array without items
      id: "sch021-tool",
      name: "sch021_tool",
      description: "d",
      inputSchema: {
        type: "object",
        properties: { tags: { type: "array" } },
        required: ["tags"],
        additionalProperties: false,
      },
      tokens: ZERO_TOKENS,
      provenance: provenance(),
    },
  ];

  return { id: "surface-dirty", tools, provider: "generic" };
}
