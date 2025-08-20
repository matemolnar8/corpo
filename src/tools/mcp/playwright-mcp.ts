import { Tool, tool } from "ai";
import { z } from "zod";
import { MCPClient, MCPTool } from "./mcp-client.ts";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { getLogLevel } from "../../utils.ts";
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
  ];

  constructor() {}

  async connect({ headless }: { headless?: boolean } = {}): Promise<void> {
    const client = new MCPClient({
      command: PLAYWRIGHT_MCP.command,
      args: [...PLAYWRIGHT_MCP.args, headless ? "--headless" : "--headed"],
    });
    await client.connect();
    if (getLogLevel() === "debug") {
      console.log("Connected to Playwright MCP");
    }
    this.client = client;
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.disconnect();
    if (getLogLevel() === "debug") {
      console.log("Disconnected from Playwright MCP");
    }
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
    if (name === "snapshotAndSave") {
      return this.snapshotAndSaveTool.execute!(args as { variable: string }, {
        messages: [],
        toolCallId: crypto.randomUUID(),
      });
    }

    return this.callMcpTool(name, args);
  }

  callMcpTool(name: string, args: Record<string, unknown>) {
    const client = this.getClient();
    return client.callTool(name, args) as Promise<PlaywrightToolOutput>;
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

    map["snapshotAndSave"] = this.snapshotAndSaveTool;

    return map;
  }

  private snapshotAndSaveTool = tool({
    description: "Take a snapshot of the current page and save it into a variable.",
    inputSchema: z.object({
      variable: z.string(),
    }),
    execute: async (options) => {
      const { variable } = options;
      const result = await this.callMcpTool("browser_snapshot", {});

      const textContent = result.content.find((content) => content.type === "text");

      const snapshot = textContent?.text.substring(
        textContent.text.indexOf("```yaml"),
        textContent.text.indexOf("```", textContent.text.indexOf("```yaml") + 6) + 3,
      );

      const snapshotWithoutYaml = snapshot?.replace(/```yaml([\s\S]*?)```/g, "$1");

      if (!snapshotWithoutYaml) {
        console.log("Couldn't create snapshot.");
        return { success: false, reason: "Couldn't create snapshot." };
      }

      setVariable(variable, snapshotWithoutYaml);
      console.log(`Snapshot saved to variable '${variable}'`);

      if (getLogLevel() === "debug") {
        console.log(`Snapshot content: ${snapshotWithoutYaml}`);
      }

      return { success: true };
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
