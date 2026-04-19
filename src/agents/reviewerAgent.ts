// src/agents/reviewerAgent.ts
// Reviews generated output — phase 1: lightweight assessment, phase 2: targeted fixes

import { AIClient, type ChatMessage } from "../lib/aiClient";
import { REVIEW_TOOL, FIX_TOOL } from "../lib/tools";
import { AGENT_SYSTEM_PROMPT } from "../config/config";
import type { GeneratedOutput, ExistingContext, AgentConfig } from "../types";

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  fixedFeatureContent?: string;
  fixedStepContent?: string;
}

export class ReviewerAgent {
  private ai: AIClient;

  constructor(config: AgentConfig) {
    this.ai = new AIClient(config);
  }

  async review(output: GeneratedOutput, context: ExistingContext): Promise<ReviewResult> {
    // ── Phase 1: lightweight review (no large content returned) ───────────
    const reviewResult = await this.runReview(output, context);

    const result: ReviewResult = {
      approved: reviewResult.approved,
      issues: reviewResult.issues ?? [],
      suggestions: reviewResult.suggestions ?? [],
    };

    // ── Phase 2: fix only what's broken, in separate focused calls ─────────
    if (reviewResult.featureNeedsFix && output.featureFile.content) {
      result.fixedFeatureContent = await this.requestFix(
        "feature file",
        output.featureFile.content,
        reviewResult.issues
      );
    }

    if (reviewResult.stepsNeedFix && output.newSteps[0]?.content) {
      result.fixedStepContent = await this.requestFix(
        "step definitions",
        output.newSteps[0].content,
        reviewResult.issues
      );
    }

    return result;
  }

  private async runReview(
    output: GeneratedOutput,
    context: ExistingContext
  ): Promise<{
    approved: boolean;
    issues: string[];
    suggestions: string[];
    featureNeedsFix: boolean;
    stepsNeedFix: boolean;
  }> {
    const existingPatterns = context.stepDefinitions
      .flatMap((s) => s.steps)
      .map((s) => `  "${s.pattern}"`)
      .join("\n");

    const prompt = `
Review these generated Cypress Cucumber test files.

=== FEATURE FILE: ${output.featureFile.filename} ===
${output.featureFile.content}

=== STEP DEFINITIONS ===
${output.newSteps.map((s) => `--- ${s.filename} ---\n${s.content}`).join("\n\n")}

=== NEW SELECTORS ===
${output.newSelectors
  .map((s) => `--- ${s.targetFile} ---\n${JSON.stringify(s.additions, null, 2)}`)
  .join("\n\n")}

=== EXISTING STEP PATTERNS (must not be duplicated) ===
${existingPatterns || "  (none)"}

CHECKLIST:
1. All feature steps implemented (reused or new)?
2. Duplicate steps vs existing definitions?
3. Selectors use '[data-cy="..."]' format?
4. Given/When/Then used correctly — no And/But as step keywords?
5. Valid Gherkin syntax?
6. Correct imports in step files?
7. Selector keys camelCase?
8. No hardcoded selectors in step bodies?

Call review_output. Keep issue descriptions to one sentence each.
`.trim();

    const result = await this.ai.complete(
      [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      [REVIEW_TOOL],
      1024
    );

    if (result.toolCall?.function.name === "review_output") {
      return AIClient.parseArgs(result.toolCall) ?? {
        approved: true,
        issues: [],
        suggestions: [],
        featureNeedsFix: false,
        stepsNeedFix: false,
      };
    }

    return { approved: true, issues: [], suggestions: [], featureNeedsFix: false, stepsNeedFix: false };
  }

  private async requestFix(
    fileType: string,
    originalContent: string,
    issues: string[]
  ): Promise<string | undefined> {
    const prompt = `
Fix the following ${fileType} based on the identified issues.

ISSUES:
${issues.map((issue, n) => `${n + 1}. ${issue}`).join("\n")}

ORIGINAL CONTENT:
${originalContent}

Call provide_fix with the fully corrected content.
`.trim();

    try {
      const result = await this.ai.complete(
        [
          { role: "system", content: AGENT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        [FIX_TOOL],
        this.ai.maxIterations * 1000   // allow enough tokens for the full corrected file
      );

      if (result.toolCall?.function.name === "provide_fix") {
        const input = AIClient.parseArgs<{ content: string }>(result.toolCall);
        return input?.content;
      }
    } catch (err) {
      console.warn(`  ⚠ Could not auto-fix ${fileType}:`, (err as Error).message);
    }

    return undefined;
  }
}
