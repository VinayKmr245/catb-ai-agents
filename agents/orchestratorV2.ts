// src/agents/orchestratorV2.ts
// Enhanced orchestrator that uses ContextManager for large-project efficiency

import chalk from "chalk";
import ora from "ora";
import type {
  TestRequirement,
  GeneratedOutput,
  AgentConfig,
  ProjectConfig,
} from "../types";
import { ContextScanner } from "../tools/contextScanner";
import { ContextManager } from "../context/contextManager";
import { FeatureAgent } from "./featureAgent";
import { StepAgent } from "./stepAgent";
import { SelectorAgent } from "./selectorAgent";
import { ReviewerAgent } from "./reviewerAgent";
import { FileWriter } from "../utils/fileWriter";

export class OrchestratorV2 {
  private scanner: ContextScanner;
  private contextManager: ContextManager;
  private featureAgent: FeatureAgent;
  private stepAgent: StepAgent;
  private selectorAgent: SelectorAgent;
  private reviewerAgent: ReviewerAgent;
  private fileWriter: FileWriter;

  constructor(
    private agentConfig: AgentConfig,
    private projectConfig: ProjectConfig
  ) {
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

    // ── Step 1: Scan full context ──────────────────────────────────────────
    const spinner = ora("Scanning project context...").start();
    const fullContext = await this.scanner.scanAll();

    // ── Step 2: Filter to relevant context ────────────────────────────────
    const filteredContext = this.contextManager.filterRelevantContext(
      fullContext,
      requirements
    );

    // Build tiered summary — compact for AI consumption
    const contextSummary = this.contextManager.buildTieredSummary(
      fullContext,
      filteredContext
    );

    const totalSteps = fullContext.stepDefinitions.reduce(
      (a, s) => a + s.steps.length,
      0
    );
    spinner.succeed(
      `Context: ${totalSteps} total steps scanned → ` +
        `${filteredContext.stepDefinitions.length} relevant files selected`
    );

    // ── Step 3: Generate Feature File ──────────────────────────────────────
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

    // ── Step 4: Generate Steps ─────────────────────────────────────────────
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

    // ── Step 5: Generate Selectors ─────────────────────────────────────────
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

    // ── Step 6: Review ─────────────────────────────────────────────────────
    const reviewSpinner = ora("Agent 4/4 → Review...").start();
    const output: GeneratedOutput = {
      featureFile: {
        filename: featureResult.filename,
        content: featureResult.content,
        path: this.projectConfig.featuresDir,
      },
      newSteps:
        stepResult.steps.length > 0
          ? [
              {
                filename: stepResult.filename,
                content: stepResult.content,
                path: this.projectConfig.stepsDir,
                steps: stepResult.steps,
              },
            ]
          : [],
      newSelectors: selectorResults,
      reusedSteps: featureResult.reusedSteps,
      summary: {
        featureName: requirements.title,
        totalScenarios: (featureResult.content.match(/^\s*Scenario/gm) || []).length,
        newStepsCreated: stepResult.steps.length,
        stepsReused: featureResult.reusedSteps.length,
        newSelectorsAdded: totalNew,
        filesModified: [],
        filesCreated: [],
      },
    };

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

    // ── Step 7: Write Files ────────────────────────────────────────────────
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

  private printSummary(output: GeneratedOutput): void {
    const s = output.summary;
    console.log(
      chalk.cyan(
        `\n✅ ${s.featureName}: ${s.totalScenarios} scenarios, ` +
          `${s.stepsReused} steps reused, ${s.newStepsCreated} new, ` +
          `${s.newSelectorsAdded} new selectors\n`
      )
    );
  }
}
