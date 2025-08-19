import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CallToolResult,
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool as MCPSDKTool,
} from "@modelcontextprotocol/sdk/types";

export type MCPTool = MCPSDKTool;

export type MCPClientOptions = {
  command: string;
  args?: readonly string[];
};

export class MCPClient {
  private options: MCPClientOptions;
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(options: MCPClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const { command, args = [] } = this.options;
    const transport = new StdioClientTransport({
      command,
      args: [...args],
    });
    const client = new Client(
      { name: "Corpo CLI", version: "0.0.1" },
      {
        capabilities: { tools: {} },
      },
    );
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
  }

  listTools(): Promise<ListToolsResult> {
    if (!this.client) throw new Error("MCP not connected");
    return this.client.listTools();
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult | CompatibilityCallToolResult> {
    if (!this.client) throw new Error("MCP not connected");
    return this.client.callTool({ name, arguments: args });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore errors
      }
    }
    this.client = undefined;
    this.transport = undefined;
  }
}
