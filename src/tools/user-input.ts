import { tool } from "ai";
import { stringifySmall } from "../log.ts";
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
    console.log(`[Custom] Running tool 'userInput' with args: ${stringifySmall({ question })}`);
    const answer = input({ message: question });
    const output = { userInput: answer ?? "" } as const;
    console.log(`[Custom] Tool 'userInput' completed with result: ${stringifySmall(output)}`);
    return output;
  },
});
