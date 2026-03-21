// src/types/index.ts
// Single canonical location for all domain types.
// No type should be defined anywhere else in the project.

// ─── Agent I/O ────────────────────────────────────────────────────────────────

export interface AgentInput {
  featureName: string;
  description: string;
  testSteps: string;
  componentDescription?: string;
  rootDir: string;
  outputDir: string;
}

export interface AgentOutput {
  featureFilePath: string;
  stepDefFilePath: string;
  selectorPatchPath?: string;
  auditLogPath?: string;
  featureContent: string;
  stepDefContent: string;
  selectorPatch?: SelectorSuggestion[];
}

export interface SelectorSuggestion {
  placeholder: string;
  suggestedTestId: string;
  elementHint: string;
}

// ─── Codebase context ─────────────────────────────────────────────────────────

export interface ContextFile {
  relativePath: string;
  content: string;
  sanitizationStats: SanitizationStats;
}

export interface SanitizationStats {
  secretsRedacted: number;
  urlsRedacted: number;
  emailsRedacted: number;
  uuidsRedacted: number;
  methodBodiesStubbed: number;
  originalLength: number;
  sanitizedLength: number;
}

export interface StepEntry {
  pattern: string;
  keyword: 'Given' | 'When' | 'Then';
  definedIn: string;
}

export interface StepRegistry {
  entries: StepEntry[];
  promptBlock: string;
}

export interface CodebaseContext {
  existingFeatures: ContextFile[];
  existingStepDefs: ContextFile[];
  pageObjects: ContextFile[];
  cypressCommands: ContextFile[];
  sampleSelectors: string[];
  stepRegistry: StepRegistry;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

export const CACHE_SCHEMA_VERSION = '1.0' as const;
export type CacheSchemaVersion = typeof CACHE_SCHEMA_VERSION;

export interface CacheEnvelope<T> {
  schemaVersion: CacheSchemaVersion;
  builtAt: string;
  projectRoot: string;
  entries: T[];
}

export interface FeatureCacheEntry {
  relativePath: string;
  contentHash: string;
  mtime: number;
  sanitizedContent: string;
  tags: string[];
  featureName: string;
  scenarioCount: number;
}

export interface StepPatternEntry {
  pattern: string;
  keyword: 'Given' | 'When' | 'Then';
}

export interface StepFileCacheEntry {
  relativePath: string;
  contentHash: string;
  mtime: number;
  sanitizedContent: string;
  patterns: StepPatternEntry[];
  importedPageObjects: string[];
}

export interface SelectorCacheEntry {
  testId: string;
  sourceFiles: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface RegistryEntry {
  pattern: string;
  keyword: 'Given' | 'When' | 'Then';
  definedIn: string;
  registeredAt: string;
}

export type FeaturesCache  = CacheEnvelope<FeatureCacheEntry>;
export type StepsCache     = CacheEnvelope<StepFileCacheEntry>;
export type SelectorsCache = CacheEnvelope<SelectorCacheEntry>;
export type RegistryCache  = CacheEnvelope<RegistryEntry>;

export interface AllCaches {
  features:  FeaturesCache;
  steps:     StepsCache;
  selectors: SelectorsCache;
  registry:  RegistryCache;
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CopilotPlan = 'individual' | 'business' | 'enterprise';

export interface CopilotConfig {
  plan: CopilotPlan;
  baseURL: string;
  token: string;
  model: string;
  maxTokens: number;
  maxRetries: number;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PhaseResult {
  phaseName: string;
  content: string;
  messagesUsed: number;
  estimatedTokens: number;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditRecord {
  timestamp: string;
  featureName: string;
  model: string;
  apiEndpoint: string;
  sanitizationSummary: SanitizationSummaryEntry[];
  phases: PhaseAuditEntry[];
}

export interface SanitizationSummaryEntry {
  file: string;
  type: string;
  originalLength: number;
  sanitizedLength: number;
  totalRedactions: number;
  methodBodiesStubbed: number;
}

export interface PhaseAuditEntry {
  phase: string;
  messageCount: number;
  estimatedTokens: number;
  messagePreviews: Array<{ role: string; preview: string; length: number }>;
}
