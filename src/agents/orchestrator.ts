// src/agents/orchestrator.ts
// Master orchestrator — coordinates the full agent pipeline

import chalk from "chalk";
import ora from "ora";
import type { TestRequirement, GeneratedOutput, AgentConfig, ProjectConfig } from "../types";
import { ContextScanner } from "../tools/contextScanner";
import { FeatureAgent } from "./featureAgent";
import { StepAgent } from "./stepAgent";
import { SelectorAgent } from "./selectorAgent";
import { ReviewerAgent } from "./reviewerAgent";
import { FileWriter } from "../utils/fileWriter";

export class Orchestrator {
  private scanner: ContextScanner;
  private featureAgent: FeatureAgent;
  private stepAgent: StepAgent;
  private selectorAgent: SelectorAgent;
  private reviewerAgent: ReviewerAgent;
  private fileWriter: FileWriter;

  constructor(agentConfig: AgentConfig, projectConfig: ProjectConfig) {
    this.scanner = new ContextScanner(projectConfig);
    this.featureAgent = new FeatureAgent(agentConfig);
    this.stepAgent = new StepAgent(agentConfig);
    this.selectorAgent = new SelectorAgent(agentConfig);
    this.reviewerAgent = new ReviewerAgent(agentConfig);
    this.fileWriter = new FileWriter(projectConfig);
  }

  async generate(requirements: TestRequirement, dryRun = false): Promise<GeneratedOutput> {
    console.log(chalk.cyan("\n🤖 Cypress AI Agent Pipeline\n"));
    console.log(chalk.gray(`   Feature:  ${requirements.title}`));
    console.log(chalk.gray(`   Source:   ${requirements.source.toUpperCase()}`));
    console.log(chalk.gray(`   AC Items: ${requirements.acceptanceCriteria.length}\n`));

    // ── 1. Scan context ───────────────────────────────────────────────────
    const scanSpinner = ora("Scanning existing Cypress files...").start();
    const context = await this.scanner.scanAll();
    const contextSummary = this.scanner.buildContextSummary(context);
    scanSpinner.succeed(
      `Context: ${context.features.length} features, ` +
        `${context.stepDefinitions.reduce((a, s) => a + s.steps.length, 0)} steps, ` +
        `${context.selectors.length} selector files`
    );

    // ── 2. Generate feature file ──────────────────────────────────────────
    const featureSpinner = ora("Agent 1/4 → Feature file...").start();
    const featureResult = await this.featureAgent.generateFeature(
      requirements,
      context,
      contextSummary
    );
    featureSpinner.succeed(
      `${featureResult.filename}: ${featureResult.reusedSteps.length} steps reused, ` +
        `${featureResult.newStepsNeeded.length} new steps needed`
    );

    // ── 3. Generate step definitions ──────────────────────────────────────
    const stepSpinner = ora("Agent 2/4 → Step definitions...").start();
    const stepResult = await this.stepAgent.generateSteps(
      requirements,
      context,
      contextSummary,
      featureResult.newStepsNeeded
    );
    stepResult.steps.length === 0
      ? stepSpinner.succeed("All steps reused from existing definitions")
      : stepSpinner.succeed(`${stepResult.filename}: ${stepResult.steps.length} new steps`);

    // ── 4. Generate selectors ─────────────────────────────────────────────
    const selSpinner = ora("Agent 3/4 → Selectors...").start();
    const selectorResults = await this.selectorAgent.generateSelectors(
      requirements,
      context,
      stepResult.content
    );
    const totalNewSelectors = selectorResults.reduce(
      (a, s) => a + Object.keys(s.additions).length,
      0
    );
    totalNewSelectors === 0
      ? selSpinner.succeed("All selectors reused")
      : selSpinner.succeed(
          `${totalNewSelectors} new selectors across ${selectorResults.length} file(s)`
        );

    // ── 5. Review ─────────────────────────────────────────────────────────
    const reviewSpinner = ora("Agent 4/4 → Review...").start();
    const output = this.buildOutput(
      requirements,
      featureResult,
      stepResult,
      selectorResults
    );

    const review = await this.reviewerAgent.review(output, context);
    this.applyFixes(output, review);

    review.approved
      ? reviewSpinner.succeed("Review passed ✓")
      : reviewSpinner.warn(`Review: ${review.issues.length} issue(s) auto-fixed`);

    if (review.suggestions.length > 0) {
      review.suggestions.forEach((s) => console.log(chalk.gray(`   💡 ${s}`)));
    }
    if (!review.approved) {
      review.issues.forEach((s) => console.warn(chalk.yellow(`   ⚠ ${s}`)));
    }

    // ── 6. Write files ────────────────────────────────────────────────────
    if (!dryRun) {
      const writeSpinner = ora("Writing files to disk...").start();
      const written = await this.fileWriter.writeAll(output);
      output.summary.filesCreated = written.created;
      output.summary.filesModified = written.modified;
      writeSpinner.succeed(
        `${written.created.length} created, ${written.modified.length} modified`
      );
    } else {
      console.log(chalk.yellow("\n  ℹ DRY RUN — no files written"));
    }

    this.printSummary(output);
    return output;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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
        path: this.scanner.projectConfig?.featuresDir ?? "",
      },
      newSteps:
        stepResult.steps.length > 0
          ? [
              {
                filename: stepResult.filename,
                content: stepResult.content,
                path: this.scanner.projectConfig?.stepsDir ?? "",
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

  private applyFixes(output: GeneratedOutput, review: Awaited<ReturnType<ReviewerAgent["review"]>>): void {
    if (review.fixedFeatureContent) output.featureFile.content = review.fixedFeatureContent;
    if (review.fixedStepContent && output.newSteps[0]) {
      output.newSteps[0].content = review.fixedStepContent;
    }
  }

  private printSummary(output: GeneratedOutput): void {
    const s = output.summary;
    console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold.white(" Generation Summary"));
    console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
    console.log(chalk.white(` Feature:        ${s.featureName}`));
    console.log(chalk.white(` Scenarios:      ${s.totalScenarios}`));
    console.log(chalk.green(` Steps reused:   ${s.stepsReused}`));
    console.log(chalk.blue(` New steps:      ${s.newStepsCreated}`));
    console.log(chalk.blue(` New selectors:  ${s.newSelectorsAdded}`));
    if (s.filesCreated.length > 0) {
      console.log(chalk.green("\n Created:"));
      s.filesCreated.forEach((f) => console.log(chalk.green(`   + ${f}`)));
    }
    if (s.filesModified.length > 0) {
      console.log(chalk.yellow("\n Modified:"));
      s.filesModified.forEach((f) => console.log(chalk.yellow(`   ~ ${f}`)));
    }
    console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  }
}
