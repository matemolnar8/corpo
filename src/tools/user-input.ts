import { tool } from "ai";
import inquirer from "inquirer";
import z from "zod";

export const userInputInputSchema = z.object({
  question: z.string().describe("The question to display for the user"),
});

export const userInputOutputSchema = z.object({
  userInput: z.string().describe("The answer provided by the user"),
});

export const userInputTool = tool({
  description: "Ask the user for input",
  inputSchema: userInputInputSchema,
  outputSchema: userInputOutputSchema,
  execute: async ({ question }) => {
    const { userInput } = await inquirer.prompt<{ userInput: string }>([
      {
        message: question,
        type: "input",
        name: "userInput",
      },
    ]);

    return {
      userInput,
    };
  },
});
