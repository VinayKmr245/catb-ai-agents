// src/agents/selectorAgent.ts
// Generates ONLY new selectors, strictly following the data-cy pattern

import { AIClient, type ChatMessage } from "../lib/aiClient";
import { SELECTOR_ADDITIONS_TOOL } from "../lib/tools";
import { AGENT_SYSTEM_PROMPT } from "../config/config";
import type {
  TestRequirement,
  ExistingContext,
  GeneratedSelectorAdditions,
  AgentConfig,
} from "../types";

export class SelectorAgent {
  private ai: AIClient;

  constructor(config: AgentConfig) {
    this.ai = new AIClient(config);
  }

  async generateSelectors(
    requirements: TestRequirement,
    context: ExistingContext,
    stepContent: string
  ): Promise<GeneratedSelectorAdditions[]> {
    const referencedSelectors = this.extractReferencedSelectors(stepContent);
    const existingKeys = new Set(
      context.selectors.flatMap((s) => Object.keys(s.selectors))
    );
    const missingSelectors = referencedSelectors.filter((s) => !existingKeys.has(s.key));

    if (missingSelectors.length === 0) return [];

    const messages: ChatMessage[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: this.buildPrompt(requirements, context, stepContent, missingSelectors),
      },
    ];

    for (let i = 0; i < this.ai.maxIterations; i++) {
      const result = await this.ai.complete(messages, [SELECTOR_ADDITIONS_TOOL], 2048);

      if (result.toolCall?.function.name === "write_selector_additions") {
        const input = AIClient.parseArgs<{
          additions: Array<{
            targetFile: string;
            exportName: string;
            isNewFile: boolean;
            newSelectors: Record<string, string>;
            patchContent?: string;
          }>;
        }>(result.toolCall);

        if (!input) throw new Error("SelectorAgent: failed to parse tool arguments");

        return input.additions.map((a) => ({
          targetFile: a.targetFile,
          exportName: a.exportName,
          additions: a.newSelectors ?? {},
          patchContent: a.patchContent ?? "",
        }));
      }

      messages.push(AIClient.assistantMessage(result));
      messages.push({ role: "user", content: "Please call the write_selector_additions tool." });
    }

    return [];
  }

  private buildPrompt(
    requirements: TestRequirement,
    context: ExistingContext,
    stepContent: string,
    missingSelectors: Array<{ selectorFile: string; key: string }>
  ): string {
    const existingFileSummary = context.selectors
      .map(
        (s) =>
          `File: ${s.name}\nexport const ${s.exportName} = {\n` +
          Object.entries(s.selectors)
            .map(([k, v]) => `  ${k}: '${v}'`)
            .join(",\n") +
          "\n}"
      )
      .join("\n\n");

    return `
EXISTING SELECTOR FILES:
${existingFileSummary || "None"}

FEATURE: ${requirements.title}

GENERATED STEP CONTENT (needing selectors):
${stepContent}

MISSING SELECTORS DETECTED:
${missingSelectors.map((s) => `  ${s.selectorFile}.${s.key}`).join("\n")}

RULES:
1. ALL selectors MUST use '[data-cy="..."]' format — no exceptions
2. Selector keys must be camelCase descriptive names
3. Group by page/component — add to an existing file where appropriate
4. data-cy values must be kebab-case, descriptive, and unique
5. New file naming: <featureName>Selectors.ts
6. Export name must match filename: loginSelectors.ts → export const loginSelectors

Call write_selector_additions with your output.
`.trim();
  }

  private extractReferencedSelectors(
    stepContent: string
  ): Array<{ selectorFile: string; key: string }> {
    const results: Array<{ selectorFile: string; key: string }> = [];
    const matches = stepContent.matchAll(/(?:sel|(\w+Selectors))\.(\w+)/g);
    for (const m of matches) {
      results.push({ selectorFile: m[1] ?? "sel", key: m[2] });
    }
    return results;
  }
}
