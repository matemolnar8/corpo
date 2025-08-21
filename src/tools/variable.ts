import { tool } from "ai";
import { stringifySmall } from "../log.ts";
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
    console.log(
      `[Custom] Running tool 'store_variable' with args: ${
        stringifySmall({ name, valueLength: value.length, overwrite })
      }`,
    );
    if (variables.has(name) && !overwrite) {
      console.log(
        `Variable '${name}' already exists and will not be overwritten`,
      );
      const output = { success: false, reason: "Variable already exists" } as const;
      console.log(`[Custom] Tool 'store_variable' completed with result: ${stringifySmall(output)}`);
      return output;
    }

    setVariable(name, value);
    console.log(`Variable '${name}' stored with value '${value.substring(0, 50)}${value.length > 50 ? "..." : ""}'`);
    const output = { success: true } as const;
    console.log(`[Custom] Tool 'store_variable' completed with result: ${stringifySmall(output)}`);
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
    console.log(`[Custom] Running tool 'retrieve_variable' with args: ${stringifySmall({ name })}`);
    if (!variables.has(name)) {
      console.log(`Variable '${name}' not found`);
      const output = { success: false, reason: "Variable not found" } as const;
      console.log(`[Custom] Tool 'retrieve_variable' completed with result: ${stringifySmall(output)}`);
      return output;
    }

    const value = getVariable(name) as string;

    console.log(
      `Variable '${name}' retrieved with value '${value.substring(0, 50)}${value.length > 50 ? "..." : ""}'`,
    );
    const output = { success: true, value } as const;
    console.log(`[Custom] Tool 'retrieve_variable' completed with result: ${stringifySmall(output)}`);
    return output;
  },
});
