import { tool } from "ai";
import { logger, stringifySmall } from "../log.ts";
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
    logger.info("Tool", `❓ user_input: prompting user with question: ${stringifySmall({ question })}`);
    logger.debug("Tool", `user_input args: ${stringifySmall({ question })}`);
    const answer = input({ message: question });
    const output = { userInput: answer ?? "" } as const;
    logger.debug("Tool", `user_input result: ${stringifySmall(output)}`);
    return output;
  },
});
