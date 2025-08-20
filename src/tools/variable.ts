import { tool } from "ai";
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

export const storeVariableTool = tool({
  description: "Store a variable for future use in a workflow",
  inputSchema: variableInputSchema,
  outputSchema: variableOutputSchema,
  execute: ({ name, value, overwrite }) => {
    if (variables.has(name) && !overwrite) {
      console.log(
        `Variable '${name}' already exists and will not be overwritten`,
      );
      return { success: false, reason: "Variable already exists" };
    }

    setVariable(name, value);
    console.log(`Variable '${name}' stored with value '${value}'`);

    return {
      success: true,
    };
  },
});

export const retrieveVariableTool = tool({
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
    if (!variables.has(name)) {
      console.log(`Variable '${name}' not found`);
      return { success: false, reason: "Variable not found" };
    }

    const value = getVariable(name);
    console.log(`Variable '${name}' retrieved with value '${value}'`);

    return {
      success: true,
      value,
    };
  },
});
