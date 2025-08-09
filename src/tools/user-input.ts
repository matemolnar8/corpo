import { tool } from "ai";
import inquirer from "inquirer";
import z from "zod";

export const userInputTool = tool({
  description: "Ask the user for input",
  inputSchema: z.object({
    question: z.string().describe("The question to display for the user"),
  }),
  execute: async ({ question }) => {
    const { userInput } = await inquirer.prompt<{ userInput: string }>([
      {
        message: question,
        type: "input",
        name: "userInput",
      },
    ]);

    return {
      userInput
    }
  },
});
