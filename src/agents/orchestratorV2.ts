// src/agents/orchestratorV2.ts
// Scale-optimised orchestrator — filters context before passing to agents
// Handles large projects with hundreds of steps/selectors efficiently

import chalk from "chalk";
import ora from "ora";
import type { TestRequirement, GeneratedOutput, AgentConfig, ProjectConfig } from "../types";
import { ContextScanner } from "../tools/contextScanner";
import { ContextManager } from "../context/contextManager";
import { FeatureAgent } from "./featureAgent";
import { StepAgent } from "./stepAgent";
import { SelectorAgent } from "./selectorAgent";
import { ReviewerAgent } from "./reviewerAgent";
import { FileWriter } from "../utils/fileWriter";

// Tuning constants for large-project optimisation
const MAX_STEPS_IN_CONTEXT = 150;       // truncate step list beyond this
const MAX_SELECTORS_IN_CONTEXT = 100;   // truncate selector list beyond this
const MAX_FEATURE_LINES_IN_CONTEXT = 50; // lines per existing feature shown

export class OrchestratorV2 {
  private scanner: ContextScanner;
  private contextManager: ContextManager;
  private featureAgent: FeatureAgent;
  private stepAgent: StepAgent;
  private selectorAgent: SelectorAgent;
  private reviewerAgent: ReviewerAgent;
  private fileWriter: FileWriter;

  constructor(agentConfig: AgentConfig, projectConfig: ProjectConfig) {
    this.scanner = new ContextScanner(projectConfig);
    this.contextManager = new ContextManager();
    this.featureAgent = new FeatureAgent(agentConfig);
    this.stepAgent = new StepAgent(agentConfig);
    this.selectorAgent = new SelectorAgent(agentConfig);
    this.reviewerAgent = new ReviewerAgent(agentConfig);
    this.fileWriter = new FileWriter(projectConfig);
  }

  async generate(requirements: TestRequirement, dryRun = false): Promise<GeneratedOutput> {
    console.log(chalk.cyan("\n🤖 Cypress AI Agent Pipeline (v2 — Scale Optimised)\n"));

    // ── 1. Scan + filter context ──────────────────────────────────────────
    const scanSpinner = ora("Scanning project context...").start();
    const fullContext = await this.scanner.scanAll();

    const totalSteps = fullContext.stepDefinitions.reduce((a, s) => a + s.steps.length, 0);
    const totalSelectors = fullContext.selectors.reduce(
      (a, s) => a + Object.keys(s.selectors).length,
      0
    );

    // Filter to semantically relevant context for this requirement
    const filteredContext = this.contextManager.filterRelevantContext(
      fullContext,
      requirements
    );

    // Build a tiered summary — most relevant steps first, then truncated remainder
    const contextSummary = this.buildOptimisedSummary(fullContext, filteredContext, requirements);

    scanSpinner.succeed(
      `Context: ${totalSteps} steps, ${totalSelectors} selectors scanned → ` +
        `${filteredContext.stepDefinitions.length} relevant step files selected`
    );

    // ── 2. Feature file ───────────────────────────────────────────────────
    const featureSpinner = ora("Agent 1/4 → Feature file...").start();
    const featureResult = await this.featureAgent.generateFeature(
      requirements,
      filteredContext,
      contextSummary
    );
    featureSpinner.succeed(
      `${featureResult.filename}: ${featureResult.reusedSteps.length} reused, ` +
        `${featureResult.newStepsNeeded.length} new steps`
    );

    // ── 3. Step definitions ───────────────────────────────────────────────
    const stepSpinner = ora("Agent 2/4 → Step definitions...").start();
    const stepResult = await this.stepAgent.generateSteps(
      requirements,
      filteredContext,
      contextSummary,
      featureResult.newStepsNeeded
    );
    stepResult.steps.length === 0
      ? stepSpinner.succeed("All steps reused")
      : stepSpinner.succeed(`${stepResult.filename}: ${stepResult.steps.length} new steps`);

    // ── 4. Selectors ──────────────────────────────────────────────────────
    const selSpinner = ora("Agent 3/4 → Selectors...").start();
    const selectorResults = await this.selectorAgent.generateSelectors(
      requirements,
      filteredContext,
      stepResult.content
    );
    const totalNew = selectorResults.reduce(
      (a, s) => a + Object.keys(s.additions).length,
      0
    );
    totalNew === 0
      ? selSpinner.succeed("All selectors reused")
      : selSpinner.succeed(`${totalNew} new selectors in ${selectorResults.length} file(s)`);

    // ── 5. Review ─────────────────────────────────────────────────────────
    const reviewSpinner = ora("Agent 4/4 → Review...").start();
    const output = this.buildOutput(requirements, featureResult, stepResult, selectorResults);

    const review = await this.reviewerAgent.review(output, filteredContext);
    if (review.fixedFeatureContent) output.featureFile.content = review.fixedFeatureContent;
    if (review.fixedStepContent && output.newSteps[0]) {
      output.newSteps[0].content = review.fixedStepContent;
    }

    review.approved
      ? reviewSpinner.succeed("Review passed ✓")
      : reviewSpinner.warn(`Review: ${review.issues.length} issue(s) auto-fixed`);

    if (review.suggestions.length > 0) {
      review.suggestions.forEach((s) => console.log(chalk.gray(`   💡 ${s}`)));
    }

    // ── 6. Write files ────────────────────────────────────────────────────
    if (!dryRun) {
      const writeSpinner = ora("Writing files...").start();
      const written = await this.fileWriter.writeAll(output);
      output.summary.filesCreated = written.created;
      output.summary.filesModified = written.modified;
      writeSpinner.succeed(
        `${written.created.length} created, ${written.modified.length} modified`
      );
    }

    this.printSummary(output);
    return output;
  }

  /**
   * Build a token-budget-aware context summary.
   *
   * Strategy:
   *  - Relevant steps (from filtered context) shown in full
   *  - Remaining steps shown as a truncated list of patterns only
   *  - Selector files shown as key lists, not full content
   *  - Existing feature files shown as first N lines only
   */
  private buildOptimisedSummary(
    fullContext: Parameters<ContextManager["filterRelevantContext"]>[0],
    filteredContext: ReturnType<ContextManager["filterRelevantContext"]>,
    requirements: TestRequirement
  ): string {
    const sections: string[] = [];

    // ── Relevant step definitions (full detail) ───────────────────────────
    const relevantStepPatterns = filteredContext.stepDefinitions
      .flatMap((s) => s.steps)
      .slice(0, MAX_STEPS_IN_CONTEXT);

    if (relevantStepPatterns.length > 0) {
      sections.push(
        "EXISTING STEP DEFINITIONS (relevant to this feature):\n" +
          relevantStepPatterns
            .map((s) => `  ${s.keyword}("${s.pattern}")`)
            .join("\n")
      );
    }

    // ── Remaining steps — patterns only, truncated ────────────────────────
    const allStepPatterns = fullContext.stepDefinitions.flatMap((s) => s.steps);
    const remainingPatterns = allStepPatterns
      .filter((s) => !relevantStepPatterns.find((r) => r.pattern === s.pattern))
      .slice(0, MAX_STEPS_IN_CONTEXT);

    if (remainingPatterns.length > 0) {
      sections.push(
        `OTHER EXISTING STEPS (${remainingPatterns.length} of ${allStepPatterns.length - relevantStepPatterns.length} shown — do not duplicate):\n` +
          remainingPatterns.map((s) => `  "${s.pattern}"`).join("\n")
      );
    }

    // ── Selector files — keys only ────────────────────────────────────────
    const selectorSummary = fullContext.selectors
      .slice(0, MAX_SELECTORS_IN_CONTEXT)
      .map((s) => `  ${s.exportName}: { ${Object.keys(s.selectors).join(", ")} }`)
      .join("\n");

    if (selectorSummary) {
      sections.push(`EXISTING SELECTOR FILES:\n${selectorSummary}`);
    }

    // ── Existing features — truncated preview ─────────────────────────────
    const featurePreview = fullContext.features
      .slice(0, 5)
      .map((f) => {
        const lines = f.content.split("\n").slice(0, MAX_FEATURE_LINES_IN_CONTEXT);
        return `--- ${f.filename} ---\n${lines.join("\n")}`;
      })
      .join("\n\n");

    if (featurePreview) {
      sections.push(`EXISTING FEATURE FILES (preview):\n${featurePreview}`);
    }

    return sections.join("\n\n");
  }

  private buildOutput(
    requirements: TestRequirement,
    featureResult: Awaited<ReturnType<FeatureAgent["generateFeature"]>>,
    stepResult: Awaited<ReturnType<StepAgent["generateSteps"]>>,
    selectorResults: Awaited<ReturnType<SelectorAgent["generateSelectors"]>>
  ): GeneratedOutput {
    return {
      featureFile: {
        filename: featureResult.filename,
        content: featureResult.content,
        path: "",
      },
      newSteps:
        stepResult.steps.length > 0
          ? [
              {
                filename: stepResult.filename,
                content: stepResult.content,
                path: "",
                steps: stepResult.steps,
              },
            ]
          : [],
      newSelectors: selectorResults,
      reusedSteps: featureResult.reusedSteps,
      summary: {
        featureName: requirements.title,
        totalScenarios: (featureResult.content.match(/^\s*Scenario/gm) ?? []).length,
        newStepsCreated: stepResult.steps.length,
        stepsReused: featureResult.reusedSteps.length,
        newSelectorsAdded: selectorResults.reduce(
          (a, s) => a + Object.keys(s.additions).length,
          0
        ),
        filesModified: [],
        filesCreated: [],
      },
    };
  }

  private printSummary(output: GeneratedOutput): void {
    const s = output.summary;
    console.log(
      chalk.cyan(
        `\n✅ ${s.featureName}: ${s.totalScenarios} scenarios | ` +
          `${s.stepsReused} reused | ${s.newStepsCreated} new steps | ` +
          `${s.newSelectorsAdded} new selectors\n`
      )
    );
  }
}
