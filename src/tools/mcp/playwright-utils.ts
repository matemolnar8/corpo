import { MCPTool } from "./mcp-client.ts";
import { isPlaywrightToolName, PLAYWRIGHT_TOOL_DESCRIPTION_OVERRIDES, PlaywrightToolName } from "./playwright-tools.ts";

export function resolvePlaywrightToolDescription(
  toolName: PlaywrightToolName,
  originalDescription: string,
): string {
  if (!isPlaywrightToolName(toolName)) {
    return originalDescription;
  }

  const base = originalDescription;
  const override = PLAYWRIGHT_TOOL_DESCRIPTION_OVERRIDES[toolName];

  if (!override) return base;
  if (typeof override === "string") return override; // full replace
  if (override.mode === "replace") return override.text;
  if (override.mode === "append") return `${base} ${override.text}`;

  return base;
}

export function withIncludeSnapshotDescription(schema: MCPTool["inputSchema"]): MCPTool["inputSchema"] {
  const properties = schema.properties ?? {};
  return {
    ...schema,
    properties: {
      ...properties,
      includeSnapshot: {
        type: "boolean",
        description: "If true, include raw YAML snapshot/image content in results.",
        default: false,
      },
    },
    additionalProperties: true,
  };
}
