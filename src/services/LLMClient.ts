// src/services/LLMClient.ts
//
// Supports multiple LLM providers through a unified interface.
// All providers expose an OpenAI-compatible /v1/chat/completions endpoint,
// so the openai SDK works with all of them via a custom baseURL.
//
// Provider           | baseURL                                          | Auth
// ───────────────────┼──────────────────────────────────────────────────┼──────────────────
// GitHub Copilot     | https://models.inference.ai.azure.com            | Bearer GITHUB_TOKEN
// Copilot Enterprise | https://api.githubcopilot.com                    | Bearer GITHUB_TOKEN
// Anthropic Claude   | https://api.anthropic.com/v1                     | x-api-key ANTHROPIC_API_KEY
// Google Gemini      | https://generativelanguage.googleapis.com/v1beta  | Bearer GEMINI_API_KEY
// OpenAI             | https://api.openai.com/v1                        | Bearer OPENAI_API_KEY
// Ollama (local)     | http://localhost:11434/v1                        | Bearer "ollama"

import OpenAI from 'openai';
import { ChatMessage, CopilotConfig } from '../types';

// ─── Provider registry ────────────────────────────────────────────────────────

export type ProviderName =
  | 'copilot'
  | 'copilot-enterprise'
  | 'claude'
  | 'gemini'
  | 'openai'
  | 'ollama';

interface ProviderDefinition {
  label:          string;
  defaultBaseURL: string;
  tokenEnvVar:    string;
  defaultModel:   string;
  authHeader?:    'bearer' | 'x-api-key';
  extraHeaders?:  Record<string, string>;
}

const PROVIDERS: Record<ProviderName, ProviderDefinition> = {
  'copilot': {
    label:          'GitHub Copilot (Individual/Business)',
    defaultBaseURL: 'https://models.inference.ai.azure.com',
    tokenEnvVar:    'GITHUB_TOKEN',
    defaultModel:   'gpt-4o',
  },
  'copilot-enterprise': {
    label:          'GitHub Copilot Enterprise',
    defaultBaseURL: 'https://api.githubcopilot.com',
    tokenEnvVar:    'GITHUB_TOKEN',
    defaultModel:   'gpt-4o',
  },
  'claude': {
    label:          'Anthropic Claude',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    tokenEnvVar:    'ANTHROPIC_API_KEY',
    defaultModel:   'claude-sonnet-4-5',
    authHeader:     'x-api-key',
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'messages-2023-12-15',
    },
  },
  'gemini': {
    label:          'Google Gemini',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    tokenEnvVar:    'GEMINI_API_KEY',
    defaultModel:   'gemini-2.0-flash',
  },
  'openai': {
    label:          'OpenAI',
    defaultBaseURL: 'https://api.openai.com/v1',
    tokenEnvVar:    'OPENAI_API_KEY',
    defaultModel:   'gpt-4o',
  },
  'ollama': {
    label:          'Ollama (local)',
    defaultBaseURL: 'http://localhost:11434/v1',
    tokenEnvVar:    'OLLAMA_TOKEN',
    defaultModel:   'qwen2.5-coder:32b',
  },
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BASE_DELAY_MS    = 1_000;
const MAX_DELAY_MS     = 30_000;

export interface LLMClientConfig extends CopilotConfig {
  provider:      ProviderName;
  providerLabel: string;
}

// ─── LLMClient ────────────────────────────────────────────────────────────────

export class LLMClient {
  private readonly client: OpenAI;
  private readonly config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
    const def   = PROVIDERS[config.provider];

    // Claude uses x-api-key header; everyone else uses Bearer
    const authHeaders: Record<string, string> =
      def.authHeader === 'x-api-key'
        ? { 'x-api-key': config.token }
        : { Authorization: `Bearer ${config.token}` };

    this.client = new OpenAI({
      apiKey:  config.token,
      baseURL: config.baseURL,
      defaultHeaders: {
        ...authHeaders,
        ...(def.extraHeaders ?? {}),
        'User-Agent': 'e2e-test-agent/5.0',
      },
      timeout: 120_000,
    });
  }

  // ─── Static factory ───────────────────────────────────────────────────────
  //
  // Reads LLM_PROVIDER from env to select a provider, then reads that
  // provider's token env var. One method, all providers.
  //
  // .env examples:
  //
  //   LLM_PROVIDER=copilot            GITHUB_TOKEN=ghp_xxx
  //   LLM_PROVIDER=claude             ANTHROPIC_API_KEY=sk-ant-xxx   MODEL=claude-sonnet-4-5
  //   LLM_PROVIDER=gemini             GEMINI_API_KEY=AIzaSy_xxx       MODEL=gemini-2.0-flash
  //   LLM_PROVIDER=openai             OPENAI_API_KEY=sk-xxx           MODEL=gpt-4o
  //   LLM_PROVIDER=ollama             OLLAMA_TOKEN=ollama             MODEL=qwen2.5-coder:32b
  //   LLM_PROVIDER=copilot-enterprise GITHUB_TOKEN=ghp_org_xxx

  static fromEnv(): LLMClientConfig {
    const providerName = (process.env.LLM_PROVIDER ?? 'copilot') as ProviderName;

    if (!PROVIDERS[providerName]) {
      throw new Error(
        `\nUnknown LLM_PROVIDER: "${providerName}".\n` +
        `Valid values: ${Object.keys(PROVIDERS).join(', ')}\n`
      );
    }

    const def   = PROVIDERS[providerName];
    const token = process.env[def.tokenEnvVar] ?? '';

    if (!token || token.includes('xxxx')) {
      throw new Error(
        `\n${def.tokenEnvVar} is not set for provider "${providerName}".\n` +
        `See README for how to obtain a key for ${def.label}.\n`
      );
    }

    const baseURL = process.env.API_BASE_URL ?? def.defaultBaseURL;
    const model   = process.env.MODEL        ?? def.defaultModel;

    return {
      provider:      providerName,
      providerLabel: def.label,
      plan:          LLMClient.detectPlan(baseURL),
      baseURL,
      token,
      model,
      maxTokens:  parseInt(process.env.MAX_TOKENS  ?? '4096', 10),
      maxRetries: parseInt(process.env.MAX_RETRIES ?? '3',    10),
    };
  }

  // ─── Verify connectivity ──────────────────────────────────────────────────

  async verify(): Promise<void> {
    console.log(`\n🔐  Verifying LLM access...`);
    console.log(`    Provider : ${this.config.providerLabel}`);
    console.log(`    Endpoint : ${this.config.baseURL}`);
    console.log(`    Model    : ${this.config.model}\n`);

    try {
      const res = await this.client.chat.completions.create({
        model:      this.config.model,
        messages:   [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 5,
      });

      const reply = res.choices[0]?.message?.content?.toLowerCase().trim() ?? '';
      if (!reply) throw new Error('Empty response');
      console.log(`✅  LLM reachable. Response: "${reply}"\n`);

    } catch (err: any) {
      throw new Error(this.translateError(err));
    }
  }

  // ─── Complete with retry + exponential backoff ────────────────────────────

  async complete(messages: ChatMessage[], temperature: number): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model:       this.config.model,
          messages:    messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          temperature,
          max_tokens:  this.config.maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('LLM returned an empty response');
        return content;

      } catch (err: any) {
        lastError = err;
        const status = err?.status ?? err?.response?.status;

        if (!RETRYABLE_STATUS.has(status) || attempt === this.config.maxRetries) {
          throw new Error(this.translateError(err));
        }

        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500,
          MAX_DELAY_MS
        );
        console.warn(
          `⚠️   LLM error (${status}) — retrying in ${Math.round(delay / 1000)}s ` +
          `(attempt ${attempt + 1}/${this.config.maxRetries})`
        );
        await sleep(delay);
      }
    }

    throw lastError ?? new Error('LLM call failed after retries');
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private translateError(err: any): string {
    const status   = err?.status ?? err?.response?.status;
    const provider = this.config.provider;

    if (status === 401 || (err?.message ?? '').includes('Unauthorized')) {
      const hints: Record<ProviderName, string> = {
        'copilot':            'Check GITHUB_TOKEN has "copilot" scope and is not expired.',
        'copilot-enterprise': 'Check GITHUB_TOKEN is an SSO-authorized org token.',
        'claude':             'Check ANTHROPIC_API_KEY at console.anthropic.com.',
        'gemini':             'Check GEMINI_API_KEY at aistudio.google.com/app/apikey.',
        'openai':             'Check OPENAI_API_KEY at platform.openai.com/api-keys.',
        'ollama':             'Ollama does not require auth — set OLLAMA_TOKEN=ollama in .env.',
      };
      return `\n  Auth failed (401) — ${hints[provider]}\n`;
    }

    if (status === 429) {
      return `\n  Rate limit (429). Increase MAX_RETRIES or wait before retrying.\n`;
    }

    if (status === 404) {
      return (
        `\n  Model "${this.config.model}" not found on ${this.config.providerLabel}.\n` +
        `  Check MODEL in .env.\n`
      );
    }

    return `\n  LLM error (${this.config.providerLabel}): ${err?.message ?? err}\n`;
  }

  private static detectPlan(baseURL: string): LLMClientConfig['plan'] {
    if (baseURL.includes('githubcopilot.com'))      return 'enterprise';
    if (baseURL.includes('inference.ai.azure.com')) return 'business';
    return 'individual';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
