import { Tool, tool } from "ai";
import { z } from "zod";
import { MCPClient, MCPTool } from "./mcp-client.ts";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { logger, stringifySmall } from "../../log.ts";
import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { setVariable } from "../variable.ts";

const PLAYWRIGHT_MCP = {
  command: "npx",
  args: ["@playwright/mcp@latest"] as const,
} as const;

type PlaywrightToolOutput = { content: (TextContent | ImageContent)[]; isError?: boolean };

export class PlaywrightMCP {
  private client?: MCPClient;

  // Allowed tool names for browser automation
  private static readonly ALLOWED_TOOL_NAMES: ReadonlyArray<string> = [
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_wait_for",
    "browser_select_option",
    "browser_tab_list",
    "browser_tab_select",
    "browser_evaluate",
    // "browser_snapshot",
  ];

  constructor() {}

  async connect({ headless }: { headless?: boolean } = {}): Promise<void> {
    const client = new MCPClient({
      command: PLAYWRIGHT_MCP.command,
      args: headless ? [...PLAYWRIGHT_MCP.args, "--headless"] : [...PLAYWRIGHT_MCP.args],
    });
    await client.connect();
    logger.debug("MCP", "Connected to Playwright MCP");
    this.client = client;
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.disconnect();
    logger.debug("MCP", "Disconnected from Playwright MCP");
  }

  private getClient(): MCPClient {
    if (!this.client) throw new Error("MCP client not connected");
    return this.client;
  }

  private filterAllowedTools(tools: MCPTool[]): MCPTool[] {
    const allowed = new Set(PlaywrightMCP.ALLOWED_TOOL_NAMES);
    return tools.filter((t) => allowed.has(t.name));
  }

  async listAllTools(): Promise<MCPTool[]> {
    const client = this.getClient();
    const { tools } = await client.listTools();
    return tools;
  }

  async listFilteredTools(): Promise<MCPTool[]> {
    const all = await this.listAllTools();
    return this.filterAllowedTools(all);
  }

  callTool(name: string, args: Record<string, unknown>) {
    if (name === "browser_snapshot_and_save") {
      return this.snapshotAndSaveTool.execute!(args as { variable: string }, {
        messages: [],
        toolCallId: crypto.randomUUID(),
      });
    }

    return this.callMcpTool(name, args);
  }

  async callMcpTool(name: string, args: Record<string, unknown>) {
    const client = this.getClient();
    logger.debug("MCP", `Tool '${name}' args: ${stringifySmall(args)}`);
    try {
      const result = await (client.callTool(name, args) as Promise<PlaywrightToolOutput>);
      logger.debug("MCP", `Tool '${name}' result: ${stringifySmall(result)}`);
      return result;
    } catch (err) {
      logger.error("MCP", `Tool '${name}' errored: ${String(err)}`);
      throw err;
    }
  }

  buildAiTools(tools: MCPTool[]) {
    const map: Record<string, Tool> = {};

    for (const t of tools) {
      map[t.name] = tool({
        description: t.description ?? `MCP tool ${t.name}`,
        inputSchema: (t.inputSchema && jsonSchema(t.inputSchema)) ??
          z.toJSONSchema(z.object({})),
        execute: (options: unknown) => {
          return this.callTool(t.name, options as Record<string, unknown>);
        },
      });
    }

    map["browser_snapshot_and_save"] = this.snapshotAndSaveTool;

    return map;
  }

  private snapshotAndSaveTool = tool({
    description: "Take a snapshot of the current page and save it into a variable.",
    inputSchema: z.object({
      variable: z.string(),
    }),
    execute: async (options) => {
      logger.debug("Tool", `snapshotAndSave args: ${stringifySmall(options)}`);
      const { variable } = options;
      const result = await this.callMcpTool("browser_snapshot", {});

      const textContent = result.content.find((content) => content.type === "text");

      const snapshot = textContent?.text.substring(
        textContent.text.indexOf("```yaml"),
        textContent.text.indexOf("```", textContent.text.indexOf("```yaml") + 6) + 3,
      );

      const snapshotWithoutYaml = snapshot?.replace(/```yaml([\s\S]*?)```/g, "$1");

      if (!snapshotWithoutYaml) {
        logger.warn("Tool", "Couldn't create snapshot.");
        const output = { success: false, reason: "Couldn't create snapshot." } as const;
        logger.debug("Tool", `snapshotAndSave result: ${stringifySmall(output)}`);
        return output;
      }

      setVariable(variable, snapshotWithoutYaml);
      logger.info("Tool", `Snapshot saved to variable '${variable}'`);
      const output = { success: true } as const;
      logger.debug("Tool", `snapshotAndSave result: ${stringifySmall(output)}`);
      return output;
    },
  });

  async getAiTools() {
    const tools = await this.listFilteredTools();
    return this.buildAiTools(tools);
  }
}

const playwrightMCP = new PlaywrightMCP();

export const connectPlaywrightMCP = async ({ headless }: { headless?: boolean } = {}) => {
  await playwrightMCP.connect({ headless });
  return playwrightMCP;
};

export const disconnectPlaywrightMCP = async () => {
  await playwrightMCP.disconnect();
};
