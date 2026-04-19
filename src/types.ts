// src/types.ts
// Central type definitions for the entire agent system

export interface RallyTicket {
  id: string;
  formattedId: string;
  name: string;
  description: string;
  acceptanceCriteria: string;
  testCases: string[];
  tags: string[];
  state: string;
  owner?: string;
  project?: string;
  attachments?: string[];
}

export interface TestRequirement {
  source: "rally" | "text";
  title: string;
  description: string;
  acceptanceCriteria: string[];
  userStories: string[];
  tags: string[];
  rawContent: string;
}

export interface ExistingContext {
  features: FeatureFile[];
  stepDefinitions: StepDefinition[];
  selectors: SelectorFile[];
}

export interface FeatureFile {
  path: string;
  name: string;
  content: string;
  scenarios: string[];
}

export interface StepDefinition {
  path: string;
  content: string;
  steps: ParsedStep[];
}

export interface ParsedStep {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  pattern: string;
  regex: string;
  hasParams: boolean;
  functionBody: string;
}

export interface SelectorFile {
  path: string;
  name: string;
  content: string;
  exportName: string;
  selectors: Record<string, string>;
}

export interface GeneratedOutput {
  featureFile: GeneratedFeature;
  newSteps: GeneratedStepDefinition[];
  newSelectors: GeneratedSelectorAdditions[];
  reusedSteps: string[];
  summary: GenerationSummary;
}

export interface GeneratedFeature {
  filename: string;
  content: string;
  path: string;
}

export interface GeneratedStepDefinition {
  filename: string;
  content: string;
  path: string;
  steps: string[];
}

export interface GeneratedSelectorAdditions {
  targetFile: string;
  exportName: string;
  additions: Record<string, string>;
  patchContent: string;
}

export interface GenerationSummary {
  featureName: string;
  totalScenarios: number;
  newStepsCreated: number;
  stepsReused: number;
  newSelectorsAdded: number;
  filesModified: string[];
  filesCreated: string[];
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentToolResult {
  toolName: string;
  result: unknown;
  error?: string;
}

// ── LLM Provider Types ─────────────────────────────────────────────────────

export type LLMProvider = "anthropic" | "groq";

export interface ProviderCapabilities {
  supportsToolUse: boolean;
  supportsSystemPrompt: boolean;
  maxContextTokens: number;
  recommendedModel: string;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: "stop" | "tool_use" | "length" | "error";
  usage?: { promptTokens: number; completionTokens: number };
}

// Agent-specific config
export interface AgentConfig {
  model: string;
  maxTokens: number;
  apiKey: string;
  maxIterations: number;
  provider: LLMProvider;
  groqApiKey?: string;
  groqModel?: string;
}

export interface ProjectConfig {
  cypressRoot: string;
  featuresDir: string;
  stepsDir: string;
  selectorsDir: string;
  rallyBaseUrl: string;
  rallyApiKey: string;
}