// src/utils/batchProcessor.ts
// Handles large-scale processing of multiple Rally tickets or requirement files
// Designed for 1000+ feature generation with rate limiting and resume support

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { Orchestrator } from "../../agents/orchestrator";
import { RallyAgent } from "../../agents/rallyAgent";
import { TextInputAgent } from "../../agents/textInputAgent";
import { MockRallyClient, RallyClient } from "../tools/rallyTool";
import type { AgentConfig, GeneratedOutput, ProjectConfig } from "../types";

interface BatchItem {
  id: string;
  type: "rally" | "text";
  input: string; // Rally URL/ID or requirements text
}

interface BatchResult {
  id: string;
  status: "success" | "failed" | "skipped";
  output?: GeneratedOutput;
  error?: string;
  duration: number;
}

interface BatchState {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: BatchResult[];
  lastProcessedIndex: number;
}

export class BatchProcessor {
  private orchestrator: Orchestrator;
  private rallyAgent: RallyAgent;
  private textAgent: TextInputAgent;
  private stateFile: string;

  constructor(
    private agentConfig: AgentConfig,
    private projectConfig: ProjectConfig,
    private options: {
      concurrency?: number;
      delayMs?: number;
      dryRun?: boolean;
      resumeOnFailure?: boolean;
      stateDir?: string;
      mockRally?: boolean;
    } = {}
  ) {
    this.orchestrator = new Orchestrator(agentConfig, projectConfig);
    this.rallyAgent = new RallyAgent(agentConfig);
    this.textAgent = new TextInputAgent(agentConfig);
    this.stateFile = path.join(
      options.stateDir || "./.batch-state",
      "batch-progress.json"
    );
  }

  /**
   * Process a list of Rally ticket IDs from a file
   * File format: one ticket ID or URL per line
   */
  async processRallyTicketFile(filePath: string): Promise<BatchState> {
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const items: BatchItem[] = lines.map((line, i) => ({
      id: `item-${i + 1}`,
      type: "rally",
      input: line,
    }));

    return this.processBatch(items);
  }

  /**
   * Process a JSON manifest of requirements
   * Format: [{ id, type, input }]
   */
  async processManifest(manifestPath: string): Promise<BatchState> {
    const items: BatchItem[] = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return this.processBatch(items);
  }

  async processBatch(items: BatchItem[]): Promise<BatchState> {
    const state = this.loadOrCreateState(items.length);
    const startIndex = state.lastProcessedIndex + 1;

    console.log(chalk.cyan(`\n📦 Batch Processing: ${items.length} items`));
    if (startIndex > 0) {
      console.log(chalk.yellow(`   Resuming from item ${startIndex + 1} of ${items.length}`));
    }
    console.log();

    const rallyClient = this.options.mockRally
      ? new MockRallyClient()
      : new RallyClient(this.projectConfig);

    for (let i = startIndex; i < items.length; i++) {
      const item = items[i];
      const startTime = Date.now();

      process.stdout.write(
        chalk.gray(`[${i + 1}/${items.length}] ${item.id} — ${item.input.slice(0, 50)}...`)
      );

      try {
        // Fetch requirements based on type
        let requirements;
        if (item.type === "rally") {
          const ticket = await rallyClient.fetchTicket(item.input);
          requirements = await this.rallyAgent.extractRequirements(ticket);
        } else {
          requirements = await this.textAgent.parseRequirements(item.input);
        }

        // Generate tests
        const output = await this.orchestrator.generate(
          requirements,
          this.options.dryRun ?? false
        );

        const duration = Date.now() - startTime;
        state.results.push({ id: item.id, status: "success", output, duration });
        state.succeeded++;

        process.stdout.write(chalk.green(` ✓ (${(duration / 1000).toFixed(1)}s)\n`));
      } catch (error) {
        const duration = Date.now() - startTime;
        const errMsg = error instanceof Error ? error.message : String(error);
        state.results.push({ id: item.id, status: "failed", error: errMsg, duration });
        state.failed++;

        process.stdout.write(chalk.red(` ✗ ${errMsg}\n`));

        if (!this.options.resumeOnFailure) {
          this.saveState(state, i);
          throw new Error(`Batch failed at item ${i + 1}: ${errMsg}`);
        }
      }

      state.processed++;
      state.lastProcessedIndex = i;
      this.saveState(state, i);

      // Rate limiting — respect API limits
      const delay = this.options.delayMs ?? 2000;
      if (i < items.length - 1 && delay > 0) {
        await sleep(delay);
      }
    }

    this.printBatchSummary(state);
    this.clearState(); // Clean up on successful completion
    return state;
  }

  private loadOrCreateState(total: number): BatchState {
    if (fs.existsSync(this.stateFile) && this.options.resumeOnFailure) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.stateFile, "utf-8")) as BatchState;
        console.log(chalk.yellow(`  Resuming from saved state (${saved.processed} already processed)`));
        return saved;
      } catch {
        // Ignore corrupt state
      }
    }
    return {
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      lastProcessedIndex: -1,
    };
  }

  private saveState(state: BatchState, currentIndex: number): void {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    state.lastProcessedIndex = currentIndex;
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  private clearState(): void {
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
  }

  private printBatchSummary(state: BatchState): void {
    console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold.white(" Batch Summary"));
    console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.white(` Total:    ${state.total}`));
    console.log(chalk.green(` Success:  ${state.succeeded}`));
    console.log(chalk.red(` Failed:   ${state.failed}`));

    if (state.failed > 0) {
      console.log(chalk.red("\n Failed items:"));
      state.results
        .filter((r) => r.status === "failed")
        .forEach((r) => console.log(chalk.red(`   • ${r.id}: ${r.error}`)));
    }

    // Write report
    const reportPath = path.join(path.dirname(this.stateFile), "batch-report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(state, null, 2));
    console.log(chalk.gray(`\n Report written to: ${reportPath}`));
    console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
