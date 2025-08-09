import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  Tool as MCPSDKTool,
  ListToolsResult,
  CallToolResult,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types";
import pkg from "../../package.json" with { type: "json" };

export type MCPTool = MCPSDKTool;

export type MCPClientOptions = {
  command: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
};

export class MCPClient {
  private options: MCPClientOptions;
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(options: MCPClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { command, args = [], env } = this.options;
    let envFiltered: Record<string, string> | undefined = undefined;
    if (env) {
      envFiltered = {};
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") envFiltered[key] = value;
      }
    }
    const transport = new StdioClientTransport({ command, args: [...args], env: envFiltered });
    const client = new Client({ name: "Corpo CLI", version: pkg.version }, {
      capabilities: { tools: {} },
    });
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
  }

  async listTools(): Promise<ListToolsResult> {
    if (!this.client) throw new Error("MCP not connected");
    return this.client.listTools();
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult | CompatibilityCallToolResult> {
    if (!this.client) throw new Error("MCP not connected");
    return this.client.callTool({ name, arguments: args });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch {}
    }
    this.client = undefined;
    this.transport = undefined;
  }
}
