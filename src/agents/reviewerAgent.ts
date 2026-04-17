// src/agents/reviewerAgent.ts
// Agent that reviews all generated output for consistency and correctness

import Groq from "groq-sdk";
import { AGENT_SYSTEM_PROMPT } from "../../agents/config";
import type { AgentConfig, ExistingContext, GeneratedOutput } from "../types";

interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  fixedFeatureContent?: string;
  fixedStepContent?: string;
}

const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "review_output",
      description: "Reviews generated Cypress test files for correctness and consistency.",
      parameters: {
        type: "object",
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
  },
];

export class ReviewerAgent {
  private client: Groq;

  constructor(private config: AgentConfig) {
    this.client = new Groq({ apiKey: config.apiKey });
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

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: 4096,
      tools: TOOLS,
      messages: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });

    const message = response.choices[0].message;
    const toolCall = message.tool_calls?.[0];

    if (toolCall?.type === "function" && toolCall.function.name === "review_output") {
      return JSON.parse(toolCall.function.arguments) as ReviewResult;
    }

    return { approved: true, issues: [], suggestions: [] };
  }
}
