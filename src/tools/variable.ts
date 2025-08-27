import { tool } from "ai";
import { logger, stringifySmall } from "../log.ts";
import z from "zod";

const variables = new Map<string, string>();

export const getVariable = (name: string) => {
  return variables.get(name);
};

export const setVariable = (name: string, value: string) => {
  variables.set(name, value);
};

export const resetVariables = () => {
  variables.clear();
};

export const variableInputSchema = z.object({
  name: z.string().describe("The name of the variable to store"),
  value: z.string().describe("The value of the variable to store"),
  overwrite: z
    .boolean()
    .default(false)
    .describe("Whether to overwrite the variable if it already exists"),
});

export const variableOutputSchema = z.object({
  success: z.boolean().describe("Whether the variable was stored successfully"),
  reason: z
    .string()
    .optional()
    .describe("The reason for the success or failure"),
});

export const storeVariableTool = tool<
  { name: string; value: string; overwrite: boolean },
  { success: boolean; reason?: string }
>({
  description: "Store a variable for future use in a workflow",
  inputSchema: variableInputSchema,
  outputSchema: variableOutputSchema,
  execute: ({ name, value, overwrite }) => {
    logger.debug(
      "Tool",
      `store_variable args: ${stringifySmall({ name, valueLength: value.length, overwrite })}`,
    );
    if (variables.has(name) && !overwrite) {
      logger.warn("Tool", `Variable '${name}' already exists and will not be overwritten`);
      const output = { success: false, reason: "Variable already exists" } as const;
      logger.debug("Tool", `store_variable result: ${stringifySmall(output)}`);
      return output;
    }

    setVariable(name, value);
    logger.info(
      "Tool",
      `📦 Variable '${name}' stored with value '${value.substring(0, 50)}${value.length > 50 ? "..." : ""}'`,
    );
    const output = { success: true } as const;
    logger.debug("Tool", `store_variable result: ${stringifySmall(output)}`);
    return output;
  },
});

export const retrieveVariableTool = tool<
  { name: string },
  { success: boolean; value?: string; reason?: string }
>({
  description: "Retrieve a variable from the workflow",
  inputSchema: z.object({
    name: z.string().describe("The name of the variable to retrieve"),
  }),
  outputSchema: z.object({
    success: z
      .boolean()
      .describe("Whether the variable was retrieved successfully"),
    value: z
      .string()
      .optional()
      .describe("The value of the variable, if found"),
    reason: z
      .string()
      .optional()
      .describe("The reason for the success or failure"),
  }),
  execute: ({ name }) => {
    logger.debug("Tool", `retrieve_variable args: ${stringifySmall({ name })}`);
    if (!variables.has(name)) {
      logger.warn("Tool", `Variable '${name}' not found`);
      const output = { success: false, reason: "Variable not found" } as const;
      logger.debug("Tool", `retrieve_variable result: ${stringifySmall(output)}`);
      return output;
    }

    const value = getVariable(name) as string;

    logger.info(
      "Tool",
      `📦 Variable '${name}' retrieved with value '${value.substring(0, 50)}${value.length > 50 ? "..." : ""}'`,
    );
    const output = { success: true, value } as const;
    logger.debug("Tool", `retrieve_variable result: ${stringifySmall(output)}`);
    return output;
  },
});

export const listVariablesTool = tool({
  description: "List names of stored workflow variables",
  inputSchema: z.object({}),
  outputSchema: z.object({ names: z.array(z.string()) }),
  execute: () => ({ names: Array.from(variables.keys()) }),
});
