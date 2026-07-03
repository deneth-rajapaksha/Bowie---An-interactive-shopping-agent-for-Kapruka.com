import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

import { selectModelName } from "@/lib/ai/router";

export type AiProviderName = "anthropic" | "openai" | "gemini" | "modal" | "openrouter";

type ProviderConfig = {
  provider: AiProviderName;
  fastModel: string;
  smartModel: string;
};

const DEFAULT_MODELS: Record<AiProviderName, { fast: string; smart: string }> = {
  anthropic: {
    fast: "claude-haiku-4-5",
    smart: "claude-sonnet-4-6"
  },
  openai: {
    fast: "gpt-4.1-mini",
    smart: "gpt-4.1"
  },
  gemini: {
    fast: "gemini-3.5-flash",
    smart: "gemini-3.5-flash"
  },
  modal: {
    fast: "bowie-modal",
    smart: "bowie-modal"
  },
  openrouter: {
    fast: "openai/gpt-oss-120b:free",
    smart: "openai/gpt-oss-120b:free"
  }
};

export function getActiveModel(
  messageCount: number,
  latestUserText: string,
  config = getProviderConfig()
): LanguageModelV1 {
  const modelName = selectModelName(
    messageCount,
    latestUserText,
    config.fastModel,
    config.smartModel
  );

  switch (config.provider) {
    case "anthropic":
      return anthropic(modelName);
    case "openai":
      return openai(modelName);
    case "gemini":
      return google(modelName);
    case "modal":
      return getModalProvider()(modelName);
    case "openrouter":
      return getOpenRouterProvider()(modelName);
  }
}

export function getProviderConfig(): ProviderConfig {
  const provider = parseProvider(
    process.env.BOWIE_AI_PROVIDER ??
      process.env.AI_PROVIDER
  );
  const defaults = DEFAULT_MODELS[provider];

  return {
    provider,
    fastModel:
      readEnv(`${provider.toUpperCase()}_FAST_MODEL`) ??
      readEnv("BOWIE_FAST_MODEL") ??
      defaults.fast,
    smartModel:
      readEnv(`${provider.toUpperCase()}_SMART_MODEL`) ??
      readEnv("BOWIE_SMART_MODEL") ??
      defaults.smart
  };
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseProvider(value: string | undefined): AiProviderName {
  if (!value) return "openai";

  const normalized = value.trim().toLowerCase();
  if (normalized === "google" || normalized === "google-generative-ai") {
    return "gemini";
  }

  if (
    normalized === "anthropic" ||
    normalized === "openai" ||
    normalized === "gemini" ||
    normalized === "modal" ||
    normalized === "openrouter"
  ) {
    return normalized;
  }

  throw new Error(
    `Invalid BOWIE_AI_PROVIDER "${value}". Use one of: anthropic, openai, gemini, modal, openrouter.`
  );
}

function getModalProvider() {
  const baseURL = process.env.MODAL_OPENAI_BASE_URL;
  if (!baseURL) {
    throw new Error("MODAL_OPENAI_BASE_URL is required when BOWIE_AI_PROVIDER=modal.");
  }

  return createOpenAI({
    name: "modal",
    baseURL: normalizeOpenAiBaseUrl(baseURL),
    apiKey: process.env.MODAL_API_KEY || "modal-local-dev",
    compatibility: "compatible"
  });
}

function normalizeOpenAiBaseUrl(baseURL: string) {
  const trimmed = baseURL.trim().replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function getOpenRouterProvider() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required when BOWIE_AI_PROVIDER=openrouter.");
  }

  return createOpenAI({
    name: "openrouter",
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    compatibility: "compatible",
    headers: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3001",
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE || "Bowie Kapruka Shopping Chat"
    }
  });
}
