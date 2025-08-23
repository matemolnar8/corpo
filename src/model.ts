import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs } from "ai";

const openrouter = createOpenRouter({
  apiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
});

export const model = openrouter("openai/gpt-4.1-mini");
export const stopWhen = stepCountIs(20);
