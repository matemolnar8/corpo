import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs } from "ai";

const openrouter = createOpenRouter({
  apiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
});

// Model configuration
// Default model can be overridden via env var MODEL_ID for easy A/B comparisons
export const modelId = Deno.env.get("MODEL_ID") ?? "google/gemini-2.5-pro";
export const model = openrouter(modelId);
export const stopWhen = stepCountIs(20);
