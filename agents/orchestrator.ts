// src/agents/orchestrator.ts
// Master orchestrator that coordinates all agents in the pipeline

import chalk from "chalk";
import ora from "ora";
import type {
  TestRequirement,
  GeneratedOutput,
  AgentConfig,
  ProjectConfig,
} from "../types";
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

  constructor(
    private agentConfig: AgentConfig,
    private projectConfig: ProjectConfig
  ) {
    this.scanner = new ContextScanner(projectConfig);
    this.featureAgent = new FeatureAgent(agentConfig);
    this.stepAgent = new StepAgent(agentConfig);
    this.selectorAgent = new SelectorAgent(agentConfig);
    this.reviewerAgent = new ReviewerAgent(agentConfig);
    this.fileWriter = new FileWriter(projectConfig);
  }

  async generate(requirements: TestRequirement, dryRun = false): Promise<GeneratedOutput> {
    console.log(chalk.cyan("\n🤖 Cypress AI Agent Pipeline Starting\n"));
    console.log(chalk.gray(`   Feature: ${requirements.title}`));
    console.log(chalk.gray(`   Source:  ${requirements.source.toUpperCase()}`));
    console.log(chalk.gray(`   AC Items: ${requirements.acceptanceCriteria.length}\n`));

    // ── Step 1: Scan existing project context ──────────────────────────────
    const spinner = ora("Scanning existing Cypress files...").start();
    const context = await this.scanner.scanAll();
    const contextSummary = this.scanner.buildContextSummary(context);
    spinner.succeed(
      `Context loaded: ${context.features.length} features, ` +
        `${context.stepDefinitions.reduce((a, s) => a + s.steps.length, 0)} steps, ` +
        `${context.selectors.length} selector files`
    );

    // ── Step 2: Generate Feature File ──────────────────────────────────────
    const featureSpinner = ora("Agent 1/4 → Generating feature file...").start();
    const featureResult = await this.featureAgent.generateFeature(
      requirements,
      context,
      contextSummary
    );
    featureSpinner.succeed(
      `Feature file generated: ${featureResult.filename} ` +
        `(${featureResult.reusedSteps.length} steps reused, ` +
        `${featureResult.newStepsNeeded.length} new steps needed)`
    );

    // ── Step 3: Generate New Step Definitions ──────────────────────────────
    const stepSpinner = ora("Agent 2/4 → Generating new step definitions...").start();
    const stepResult = await this.stepAgent.generateSteps(
      requirements,
      context,
      contextSummary,
      featureResult.newStepsNeeded
    );

    if (stepResult.steps.length === 0) {
      stepSpinner.succeed("No new steps needed — all reused from existing definitions");
    } else {
      stepSpinner.succeed(
        `Step definitions generated: ${stepResult.filename} (${stepResult.steps.length} new steps)`
      );
    }

    // ── Step 4: Generate New Selectors ─────────────────────────────────────
    const selSpinner = ora("Agent 3/4 → Analysing and generating selectors...").start();
    const selectorResults = await this.selectorAgent.generateSelectors(
      requirements,
      context,
      stepResult.content
    );

    const totalNewSelectors = selectorResults.reduce(
      (a, s) => a + Object.keys(s.additions).length,
      0
    );

    if (totalNewSelectors === 0) {
      selSpinner.succeed("No new selectors needed — all reused from existing files");
    } else {
      selSpinner.succeed(
        `Selectors generated: ${totalNewSelectors} new selectors across ${selectorResults.length} file(s)`
      );
    }

    // ── Step 5: Review ─────────────────────────────────────────────────────
    const reviewSpinner = ora("Agent 4/4 → Reviewing generated output...").start();

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
        totalScenarios: this.countScenarios(featureResult.content),
        newStepsCreated: stepResult.steps.length,
        stepsReused: featureResult.reusedSteps.length,
        newSelectorsAdded: totalNewSelectors,
        filesModified: [],
        filesCreated: [],
      },
    };

    const review = await this.reviewerAgent.review(output, context);

    if (!review.approved && review.issues.length > 0) {
      reviewSpinner.warn(`Review found ${review.issues.length} issue(s) — auto-fixing...`);
      // Apply fixes if reviewer provided them
      if (review.fixedFeatureContent) {
        output.featureFile.content = review.fixedFeatureContent;
      }
      if (review.fixedStepContent && output.newSteps.length > 0) {
        output.newSteps[0].content = review.fixedStepContent;
      }
      review.issues.forEach((issue) => console.warn(chalk.yellow(`   ⚠ ${issue}`)));
    } else {
      reviewSpinner.succeed("Review passed ✓");
    }

    if (review.suggestions.length > 0) {
      console.log(chalk.gray("\n  Suggestions:"));
      review.suggestions.forEach((s) => console.log(chalk.gray(`   • ${s}`)));
    }

    // ── Step 6: Write Files ────────────────────────────────────────────────
    if (!dryRun) {
      const writeSpinner = ora("Writing files to disk...").start();
      const written = await this.fileWriter.writeAll(output);
      output.summary.filesCreated = written.created;
      output.summary.filesModified = written.modified;
      writeSpinner.succeed(`Files written: ${written.created.length} created, ${written.modified.length} modified`);
    } else {
      console.log(chalk.yellow("\n  ℹ DRY RUN — no files written to disk"));
    }

    // ── Summary ────────────────────────────────────────────────────────────
    this.printSummary(output);
    return output;
  }

  private countScenarios(featureContent: string): number {
    return (featureContent.match(/^\s*Scenario/gm) || []).length;
  }

  private printSummary(output: GeneratedOutput): void {
    const s = output.summary;
    console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold.white(" Generation Summary"));
    console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
    console.log(chalk.white(` Feature:          ${s.featureName}`));
    console.log(chalk.white(` Scenarios:        ${s.totalScenarios}`));
    console.log(chalk.green(` Steps reused:     ${s.stepsReused}`));
    console.log(chalk.blue(` New steps:        ${s.newStepsCreated}`));
    console.log(chalk.blue(` New selectors:    ${s.newSelectorsAdded}`));
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
