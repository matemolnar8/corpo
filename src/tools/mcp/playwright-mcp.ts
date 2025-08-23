import { Tool, tool } from "ai";
import { z } from "zod";
import { MCPClient, MCPTool } from "./mcp-client.ts";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { logger, stringifySmall } from "../../log.ts";
import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { setVariable } from "../variable.ts";
import { replaceSecretsInArgs } from "../secret.ts";
import { deferPromise } from "../../utils.ts";

const PLAYWRIGHT_MCP = {
  command: "npx",
  args: ["@playwright/mcp@latest"] as const,
} as const;

export type PlaywrightToolOutput = { content: (TextContent | ImageContent)[]; isError?: boolean };

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

  private previousToolPromise?: Promise<void>;

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { includeSnapshot?: boolean } = {},
  ) {
    // Wait for previous tool to complete
    if (this.previousToolPromise) {
      logger.debug("MCP", "Waiting for previous tool to complete");
      await this.previousToolPromise;
    }
    const previousToolDeferred = deferPromise<void>();
    this.previousToolPromise = previousToolDeferred.promise;

    // Workaround for race condition in Playwright MCP
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (name === "browser_snapshot_and_save") {
      return this.snapshotAndSaveTool.execute!(args as { variable: string }, {
        messages: [],
        toolCallId: crypto.randomUUID(),
      });
    }

    const result = await this.callMcpTool(name, args, options);
    previousToolDeferred.resolve();
    return result;
  }

  async callMcpTool(
    name: string,
    args: Record<string, unknown>,
    options: { includeSnapshot?: boolean } = {},
  ) {
    const client = this.getClient();
    // Log placeholders but not resolved secret values
    logger.debug("MCP", `Tool '${name}' args: ${stringifySmall(args)}`);
    try {
      const safeArgs = replaceSecretsInArgs(args);
      const result = await (client.callTool(name, safeArgs) as Promise<PlaywrightToolOutput>);
      const filtered = options.includeSnapshot ? result : this.removeSnapshots(result);
      logger.debug("MCP", `Tool '${name}' result: ${stringifySmall(filtered)}`);
      return filtered;
    } catch (err) {
      logger.error("MCP", `Tool '${name}' errored: ${String(err)}`);
      throw err;
    }
  }

  buildAiTools(tools: MCPTool[]) {
    const map: Record<string, Tool> = {};

    for (const t of tools) {
      const baseProps = t.inputSchema?.properties ?? {};
      const baseRequired = t.inputSchema?.required ?? [];
      const inputSchema = jsonSchema(
        {
          type: "object",
          properties: {
            ...baseProps,
            includeSnapshot: {
              type: "boolean",
              description: "If true, include raw YAML snapshot/image content in results.",
              default: false,
            },
          },
          required: baseRequired,
          additionalProperties: true,
        } as const,
      );
      map[t.name] = tool({
        description: t.description ?? `MCP tool ${t.name}`,
        inputSchema,
        execute: (options: unknown) => {
          const { includeSnapshot, ...rest } = (options as Record<string, unknown>) ?? {};
          return this.callTool(t.name, rest as Record<string, unknown>, {
            includeSnapshot: Boolean(includeSnapshot),
          });
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
      const result = await this.callMcpTool("browser_snapshot", {}, { includeSnapshot: true });

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

  private removeSnapshots(result: PlaywrightToolOutput): PlaywrightToolOutput {
    try {
      const filteredContent: (TextContent | ImageContent)[] = [];
      for (const c of result.content) {
        if (c.type === "text") {
          const withoutYaml = c.text.replace(/```yaml[\s\S]*?```/g, "").trim();
          if (withoutYaml) {
            filteredContent.push({ type: "text", text: withoutYaml });
          }
        } else if (c.type === "image") {
          filteredContent.push(c);
        }
      }
      return { ...result, content: filteredContent };
    } catch {
      return result;
    }
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
