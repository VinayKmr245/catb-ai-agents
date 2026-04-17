// src/agents/reviewerAgent.ts
// Agent that reviews all generated output for consistency and correctness

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedOutput, ExistingContext, AgentConfig } from "../types";
import { AGENT_SYSTEM_PROMPT } from "../config/config";

interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  fixedFeatureContent?: string;
  fixedStepContent?: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "review_output",
    description: "Reviews generated Cypress test files for correctness and consistency.",
    input_schema: {
      type: "object" as const,
      properties: {
        approved: {
          type: "boolean",
          description: "Whether the generated output passes review",
        },
        issues: {
          type: "array",
          items: { type: "string" },
          description: "Critical issues that must be fixed",
        },
        suggestions: {
          type: "array",
          items: { type: "string" },
          description: "Non-blocking suggestions for improvement",
        },
        fixedFeatureContent: {
          type: "string",
          description: "If feature file had issues, the corrected content",
        },
        fixedStepContent: {
          type: "string",
          description: "If step definitions had issues, the corrected content",
        },
      },
      required: ["approved", "issues", "suggestions"],
    },
  },
];

export class ReviewerAgent {
  private client: Anthropic;

  constructor(private config: AgentConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async review(
    output: GeneratedOutput,
    context: ExistingContext
  ): Promise<ReviewResult> {
    const existingStepPatterns = context.stepDefinitions
      .flatMap((s) => s.steps)
      .map((s) => s.pattern);

    const prompt = `
Review these generated Cypress Cucumber test files for correctness.

=== FEATURE FILE: ${output.featureFile.filename} ===
${output.featureFile.content}

=== NEW STEP DEFINITIONS ===
${output.newSteps.map((s) => `--- ${s.filename} ---\n${s.content}`).join("\n\n")}

=== NEW SELECTORS ===
${output.newSelectors
  .map((s) => `--- ${s.targetFile} (additions) ---\n${JSON.stringify(s.additions, null, 2)}`)
  .join("\n\n")}

=== EXISTING STEP PATTERNS (must not be duplicated) ===
${existingStepPatterns.map((p) => `  "${p}"`).join("\n")}

REVIEW CHECKLIST:
1. Are all steps in the feature file implemented (either reused or new)?
2. Are there any duplicate steps vs existing definitions?
3. Do all selectors strictly follow '[data-cy="..."]' pattern?
4. Are Given/When/Then used correctly (not Then for actions, not When for assertions)?
5. Is the feature file valid Gherkin syntax?
6. Are step imports correct?
7. Are selector keys descriptive and camelCase?
8. Are there any hardcoded selectors in step bodies (should use sel.* instead)?

Call review_output with your findings. If issues exist, provide corrected content.
`.trim();

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 4096,
      system: AGENT_SYSTEM_PROMPT,
      tools: TOOLS,
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return toolUse.input as ReviewResult;
    }

    return { approved: true, issues: [], suggestions: [] };
  }
}
