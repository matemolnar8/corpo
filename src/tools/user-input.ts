import { tool } from "ai";
import { input } from "../cli_prompts.ts";
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
  execute: ({ question }) => {
    const answer = input({ message: question });
    return { userInput: answer ?? "" };
  },
});
