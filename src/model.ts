import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { stepCountIs } from "ai";

const openrouter = createOpenRouter({
  apiKey: Deno.env.get("OPENROUTER_API_KEY") ?? "",
});

// Model configuration
// Global default can be overridden via env var MODEL_ID.
// Recorder and Runner can be configured independently via RECORDER_MODEL_ID and RUNNER_MODEL_ID.
export const defaultModelId = "x-ai/grok-4-fast:free";
export const modelId = Deno.env.get("MODEL_ID") ?? defaultModelId;

export const recorderModelId = Deno.env.get("RECORDER_MODEL_ID") ?? modelId;
export const runnerModelId = Deno.env.get("RUNNER_MODEL_ID") ?? modelId;

export const recorderModel = openrouter(recorderModelId);
export const runnerModel = openrouter(runnerModelId);

// Deprecated: kept for backward compatibility with any legacy imports
export const model = openrouter(modelId);
export const stopWhen = stepCountIs(30);
