// src/agents/featureAgent.ts
// Generates Gherkin feature files from requirements + existing context

import { AIClient, type ChatMessage } from "../lib/aiClient";
import { FEATURE_FILE_TOOL } from "../lib/tools";
import { AGENT_SYSTEM_PROMPT } from "../config/config";
import type { TestRequirement, ExistingContext, GeneratedFeature, AgentConfig } from "../types";

export interface FeatureResult extends GeneratedFeature {
  reusedSteps: string[];
  newStepsNeeded: Array<{ keyword: string; pattern: string; purpose: string }>;
}

export class FeatureAgent {
  private ai: AIClient;

  constructor(config: AgentConfig) {
    this.ai = new AIClient(config);
  }

  async generateFeature(
    requirements: TestRequirement,
    context: ExistingContext,
    contextSummary: string
  ): Promise<FeatureResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: this.buildPrompt(requirements, contextSummary),
      },
    ];

    for (let i = 0; i < this.ai.maxIterations; i++) {
      const result = await this.ai.complete(messages, [FEATURE_FILE_TOOL]);

      if (result.toolCall?.function.name === "write_feature_file") {
        const input = AIClient.parseArgs<{
          filename: string;
          content: string;
          reusedSteps?: string[];
          newStepsNeeded?: Array<{ keyword: string; pattern: string; purpose: string }>;
        }>(result.toolCall);

        if (!input) throw new Error("FeatureAgent: failed to parse tool arguments");

        return {
          filename: input.filename,
          content: input.content,
          path: `${requirements.title.replace(/\s+/g, "-").toLowerCase()}/`,
          reusedSteps: input.reusedSteps ?? [],
          newStepsNeeded: (input.newStepsNeeded ?? []).map((s) => ({
            ...s,
            keyword: this.normaliseKeyword(s.keyword),
          })),
        };
      }

      messages.push(AIClient.assistantMessage(result));
      messages.push({ role: "user", content: "Please call the write_feature_file tool." });
    }

    throw new Error("FeatureAgent exceeded max iterations without calling tool");
  }

  private buildPrompt(requirements: TestRequirement, contextSummary: string): string {
    return `
${contextSummary}

---

REQUIREMENTS TO TEST:
Title: ${requirements.title}
Description: ${requirements.description}
Source: ${requirements.source}
Tags: ${requirements.tags.join(", ")}

User Stories:
${requirements.userStories.map((s) => `  - ${s}`).join("\n")}

Acceptance Criteria:
${requirements.acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

TASK: Generate a complete Gherkin feature file.
- REUSE existing step definitions wherever possible
- List which new steps are needed — they will be generated next
- Use Background for repeated setup steps
- Cover happy paths, edge cases, and error scenarios
- Each scenario must be independent
- Tag the feature and scenarios with @${requirements.tags.join(" @")}
- newStepsNeeded keyword must be Given, When, or Then — never And or But

Call write_feature_file with your output.
`.trim();
  }

  /** Ensure And/But from LLM output are mapped to a valid keyword */
  private normaliseKeyword(keyword: string): string {
    if (["Given", "When", "Then"].includes(keyword)) return keyword;
    return "When";
  }
}
