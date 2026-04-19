// src/agents/reviewerAgent.ts
// Agent that reviews all generated output for consistency and correctness

import Groq from "groq-sdk";
import type { GeneratedOutput, ExistingContext, AgentConfig } from "../types";
import { AGENT_SYSTEM_PROMPT } from "../config/config";

interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  fixedFeatureContent?: string;
  fixedStepContent?: string;
}

// Phase 1: lightweight review — only booleans and short strings, no large content
const REVIEW_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "review_output",
      description: "Reviews generated Cypress test files and reports issues found.",
      parameters: {
        type: "object",
        properties: {
          approved: {
            type: "boolean",
            description: "True if no critical issues were found",
          },
          issues: {
            type: "array",
            items: { type: "string" },
            description: "Critical issues that must be fixed (short descriptions)",
          },
          suggestions: {
            type: "array",
            items: { type: "string" },
            description: "Non-blocking suggestions for improvement",
          },
          featureNeedsFix: {
            type: "boolean",
            description: "True if the feature file requires corrections",
          },
          stepsNeedFix: {
            type: "boolean",
            description: "True if the step definitions require corrections",
          },
        },
        required: ["approved", "issues", "suggestions", "featureNeedsFix", "stepsNeedFix"],
      },
    },
  },
];

// Phase 2: fix — returns only the corrected file content
const FIX_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "provide_fix",
      description: "Returns the fully corrected file content after issues were identified.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The complete corrected file content",
          },
        },
        required: ["content"],
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

    const reviewPrompt = `
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
4. Are Given/When/Then used correctly?
5. Is the feature file valid Gherkin syntax?
6. Are step imports correct?
7. Are selector keys descriptive and camelCase?
8. Are there hardcoded selectors in step bodies (should use sel.* instead)?

Call review_output with your findings. Keep issue descriptions short (one sentence each).
`.trim();

    // ── Phase 1: Review ────────────────────────────────────────────────────
    const reviewResponse = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: 1024,
      tools: REVIEW_TOOLS,
      messages: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        { role: "user", content: reviewPrompt },
      ],
    });

    const reviewMessage = reviewResponse.choices[0].message;
    const reviewToolCall = reviewMessage.tool_calls?.[0];

    if (!reviewToolCall || reviewToolCall.type !== "function") {
      return { approved: true, issues: [], suggestions: [] };
    }

    const reviewResult = JSON.parse(reviewToolCall.function.arguments) as {
      approved: boolean;
      issues: string[];
      suggestions: string[];
      featureNeedsFix: boolean;
      stepsNeedFix: boolean;
    };

    const result: ReviewResult = {
      approved: reviewResult.approved,
      issues: reviewResult.issues ?? [],
      suggestions: reviewResult.suggestions ?? [],
    };

    // ── Phase 2: Fix feature file if needed ────────────────────────────────
    if (reviewResult.featureNeedsFix && output.featureFile.content) {
      result.fixedFeatureContent = await this.requestFix(
        "feature file",
        output.featureFile.content,
        reviewResult.issues
      );
    }

    // ── Phase 3: Fix step definitions if needed ────────────────────────────
    if (reviewResult.stepsNeedFix && output.newSteps[0]?.content) {
      result.fixedStepContent = await this.requestFix(
        "step definitions",
        output.newSteps[0].content,
        reviewResult.issues
      );
    }

    return result;
  }

  private async requestFix(
    fileType: string,
    originalContent: string,
    issues: string[]
  ): Promise<string | undefined> {
    const fixPrompt = `
Fix the following ${fileType} based on these identified issues:

ISSUES TO FIX:
${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

ORIGINAL CONTENT:
${originalContent}

Call provide_fix with the fully corrected content.
`.trim();

    try {
      const fixResponse = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 4096,
        tools: FIX_TOOLS,
        messages: [
          { role: "system", content: AGENT_SYSTEM_PROMPT },
          { role: "user", content: fixPrompt },
        ],
      });

      const fixMessage = fixResponse.choices[0].message;
      const fixToolCall = fixMessage.tool_calls?.[0];

      if (fixToolCall?.type === "function" && fixToolCall.function.name === "provide_fix") {
        const input = JSON.parse(fixToolCall.function.arguments) as { content: string };
        return input.content;
      }
    } catch (err) {
      console.warn(`  ⚠ Could not auto-fix ${fileType}:`, (err as Error).message);
    }

    return undefined;
  }
}
