import { Tool, tool } from "ai";
import { z } from "zod";
import { MCPClient, MCPTool } from "./mcp-client.ts";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { logger, spinner, stringifySmall } from "../../log.ts";
import type { ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { setVariable } from "../variable.ts";
import { replaceSecretsInArgsWithTracking, replaceSecretsInResultAllowed } from "../secret.ts";
import { deferPromise } from "../../utils.ts";
import { resolvePlaywrightToolDescription, withIncludeSnapshotDescription } from "./playwright-utils.ts";
import { PLAYWRIGHT_ALLOWED_TOOL_NAMES } from "./playwright-tools.ts";

const PLAYWRIGHT_MCP = {
  command: "npx",
  args: ["@playwright/mcp@0.0.37"] as const,
} as const;

export type PlaywrightToolOutput = { content: (TextContent | ImageContent)[]; isError?: boolean };

export class PlaywrightMCP {
  private client?: MCPClient;

  constructor() {}

  async connect({ headless }: { headless?: boolean } = {}): Promise<void> {
    const client = new MCPClient({
      command: PLAYWRIGHT_MCP.command,
      args: headless ? [...PLAYWRIGHT_MCP.args, "--headless"] : [...PLAYWRIGHT_MCP.args],
    });
    await client.connect();
    logger.debug("PlaywrightMCP", "Connected to Playwright MCP");
    this.client = client;
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.disconnect();
    logger.debug("PlaywrightMCP", "Disconnected from Playwright MCP");
  }

  private getClient(): MCPClient {
    if (!this.client) throw new Error("PlaywrightMCP client not connected");
    return this.client;
  }

  private filterAllowedTools(tools: MCPTool[]): MCPTool[] {
    const allowed = new Set(PLAYWRIGHT_ALLOWED_TOOL_NAMES);

    // assert that every tool name in allowed is in tools
    for (const name of allowed) {
      if (!tools.some((t) => t.name === name)) {
        throw new Error(`Tool '${name}' is not provided by Playwright MCP`);
      }
    }

    const filtered = tools.filter((t) => allowed.has(t.name));
    return filtered;
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

  // Yay single threading!
  private previousToolPromise?: Promise<void>;

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { includeSnapshot?: boolean } = {},
  ) {
    spinner.addText(`Running Playwright tool '${name}'...`);
    const startTimeMs = Date.now();
    const originalPreviousToolPromise = this.previousToolPromise;
    const previousToolDeferred = deferPromise<void>();
    this.previousToolPromise = previousToolDeferred.promise;
    // Wait for previous tool to complete
    if (originalPreviousToolPromise) {
      logger.debug("PlaywrightMCP", "Waiting for previous tool to complete");
      await originalPreviousToolPromise;
    } else {
      logger.debug("PlaywrightMCP", "No previous tool to wait for");
    }

    // Workaround for race condition in Playwright MCP
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let result;
    try {
      if (name === "browser_snapshot_and_save") {
        result = await this.snapshotAndSaveTool.execute!(args as { variable: string }, {
          messages: [],
          toolCallId: crypto.randomUUID(),
        });
      } else {
        result = await this.callMcpTool(name, args, options);
      }
      const durationMs = Date.now() - startTimeMs;
      logger.info("PlaywrightMCP", `⏱️ Tool '${name}' in ${durationMs}ms with args: ${stringifySmall(args)}`);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTimeMs;
      logger.error(
        "PlaywrightMCP",
        `⏱️ Tool '${name}' failed after ${durationMs}ms with args: ${stringifySmall(args)}: ${String(err)}`,
      );
      throw err;
    } finally {
      previousToolDeferred.resolve();
      spinner.removeText();
    }
  }

  async callMcpTool(
    name: string,
    args: Record<string, unknown>,
    options: { includeSnapshot?: boolean } = {},
  ) {
    const client = this.getClient();
    // Log placeholders but not resolved secret values
    logger.debug("PlaywrightMCP", `Tool '${name}' args: ${stringifySmall(args)}`);
    try {
      const { value: safeArgs, usedSecretNames } = replaceSecretsInArgsWithTracking(args);
      const result = await (client.callTool(name, safeArgs) as Promise<PlaywrightToolOutput>);
      const filtered = options.includeSnapshot ? result : this.removeSnapshots(result);
      const masked = replaceSecretsInResultAllowed(filtered, usedSecretNames);
      logger.debug("PlaywrightMCP", `Tool '${name}' result: ${stringifySmall(masked)}`);
      return masked;
    } catch (err) {
      logger.error("PlaywrightMCP", `Tool '${name}' errored: ${String(err)}`);
      throw err;
    }
  }

  buildAiTools(tools: MCPTool[]) {
    const map: Record<string, Tool> = {};

    for (const t of tools) {
      const inputSchema = jsonSchema(withIncludeSnapshotDescription(t.inputSchema));
      map[t.name] = tool({
        description: resolvePlaywrightToolDescription(t.name, t.description ?? t.name),
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
      logger.debug("PlaywrightMCP", `snapshotAndSave args: ${stringifySmall(options)}`);
      const startTimeMs = Date.now();
      const { variable } = options;
      logger.info("PlaywrightMCP", `📸 snapshot_and_save: saving snapshot to variable '${variable}'`);
      const result = await this.callMcpTool("browser_snapshot", {}, { includeSnapshot: true });

      const textContent = result.content.find((content) => content.type === "text");

      const snapshot = textContent?.text.substring(
        textContent.text.indexOf("```yaml"),
        textContent.text.indexOf("```", textContent.text.indexOf("```yaml") + 6) + 3,
      );

      const snapshotWithoutYaml = snapshot?.replace(/```yaml([\s\S]*?)```/g, "$1");

      if (!snapshotWithoutYaml) {
        logger.warn("PlaywrightMCP", "📸 Couldn't create snapshot.");
        const output = { success: false, reason: "Couldn't create snapshot." } as const;
        logger.debug("PlaywrightMCP", `snapshotAndSave result: ${stringifySmall(output)}`);
        const durationMs = Date.now() - startTimeMs;
        logger.info("PlaywrightMCP", `snapshot_and_save failed after ${durationMs}ms`);
        return output;
      }

      setVariable(variable, snapshotWithoutYaml);
      logger.info("PlaywrightMCP", `📸 Snapshot saved to variable '${variable}'`);
      const output = { success: true } as const;
      logger.debug("PlaywrightMCP", `snapshotAndSave result: ${stringifySmall(output)}`);
      const durationMs = Date.now() - startTimeMs;
      logger.info("PlaywrightMCP", `📸 snapshot_and_save finished in ${durationMs}ms`);
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
          const withoutPageSnapshotHeader = c.text.replace(/^- Page Snapshot:/, "");
          const withoutYaml = withoutPageSnapshotHeader.replace(/```yaml[\s\S]*?```/g, "").trim();
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
