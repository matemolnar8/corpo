import { tool } from "ai";
import { z } from "zod";
import { MCPClient, MCPTool } from "./mcp-client.ts";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { getLogLevel } from "../../utils.ts";

const PLAYWRIGHT_MCP = {
  command: "npx",
  args: ["@playwright/mcp@latest"] as const,
} as const;

export class PlaywrightMCP {
  private client?: MCPClient;

  // Allowed tool names for browser automation
  private static readonly ALLOWED_TOOL_NAMES: ReadonlyArray<string> = [
    "browser_navigate",
    "browser_click",
    "browser_snapshot",
    "browser_type",
    "browser_wait_for",
    "browser_select_option",
    "browser_tab_list",
    "browser_tab_select",
  ];

  constructor() {}

  async connect(): Promise<void> {
    const client = new MCPClient({
      command: PLAYWRIGHT_MCP.command,
      args: PLAYWRIGHT_MCP.args,
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
    const client = this.getClient();
    return client.callTool(name, args);
  }

  buildAiTools(tools: MCPTool[]) {
    const map: Record<string, unknown> = {};
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
    return map;
  }

  async getAiTools() {
    const tools = await this.listFilteredTools();
    return this.buildAiTools(tools);
  }
}
