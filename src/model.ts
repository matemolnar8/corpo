import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs } from "ai";

const openrouter = createOpenRouter({
  apiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
});

export const model = openrouter("google/gemini-2.5-flash");
export const stopWhen = stepCountIs(20);
