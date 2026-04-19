// src/lib/aiClient.ts
// Thin wrapper around Azure OpenAI SDK — single place for all API calls

import { AzureOpenAI } from "openai";
import type { AgentConfig } from "../types";

export type ChatMessage = Parameters<AzureOpenAI["chat"]["completions"]["create"]>[0]["messages"][number];
export type Tool = NonNullable<Parameters<AzureOpenAI["chat"]["completions"]["create"]>[0]["tools"]>[number];
export type ToolCall = NonNullable<Awaited<ReturnType<AzureOpenAI["chat"]["completions"]["create"]>>["choices"][0]["message"]["tool_calls"]>[number];

export interface CompletionResult {
  content: string | null;
  toolCall: ToolCall | null;
  toolCalls: ToolCall[];
  rawMessage: Awaited<ReturnType<AzureOpenAI["chat"]["completions"]["create"]>>["choices"][0]["message"];
}

export class AIClient {
  private client: AzureOpenAI;

  constructor(private config: AgentConfig) {
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.azureEndpoint,
      apiVersion: config.azureApiVersion,
      deployment: config.azureDeployment,
    });
  }

  async complete(
    messages: ChatMessage[],
    tools?: Tool[],
    maxTokens?: number
  ): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.config.azureDeployment,   // Azure ignores this but SDK requires it
      max_tokens: maxTokens ?? this.config.maxTokens,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    const message = response.choices[0].message;
    const toolCalls = message.tool_calls ?? [];

    return {
      content: message.content,
      toolCall: toolCalls[0] ?? null,
      toolCalls,
      rawMessage: message,
    };
  }

  /** Safely parse tool call arguments — returns null on failure */
  static parseArgs<T>(toolCall: ToolCall): T | null {
    try {
      return JSON.parse(toolCall.function.arguments) as T;
    } catch {
      return null;
    }
  }

  /** Build an assistant turn message for multi-turn agentic loops */
  static assistantMessage(result: CompletionResult): ChatMessage {
    return {
      role: "assistant",
      content: result.content ?? "",
      ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
    };
  }

  get maxIterations(): number {
    return this.config.maxIterations;
  }

  get deployment(): string {
    return this.config.azureDeployment;
  }
}
