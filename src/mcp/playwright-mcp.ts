import { tool } from "ai";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";
import { MCPClient, MCPTool } from "./mcp-client.js";

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
    "browser_select_option"
  ];

  async connect(): Promise<void> {
    const client = new MCPClient({ command: PLAYWRIGHT_MCP.command, args: PLAYWRIGHT_MCP.args });
    await client.connect();
    this.client = client;
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.disconnect();
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

  async callTool(name: string, args: Record<string, unknown>) {
    const client = this.getClient();
    return client.callTool(name, args);
  }

  buildAiTools(tools: MCPTool[]) {
    const map: Record<string, any> = {};
    for (const t of tools) {
      map[t.name] = tool({
        description: t.description ?? `MCP tool ${t.name}`,
        inputSchema: (t.inputSchema ? jsonSchema(t.inputSchema as any) : z
          .record(z.any())
          .describe("Arguments for the MCP tool call")),
        execute: async (options: any) => {
          const input = options?.input ?? options ?? {};
          return this.callTool(t.name, input);
        },
      } as any);
    }
    return map;
  }

  async getAiTools() {
    const tools = await this.listFilteredTools();
    return this.buildAiTools(tools);
  }
}


