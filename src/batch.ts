// src/batch.ts
// CLI for batch processing — handles 1000+ features at scale

import chalk from "chalk";
import { program } from "commander";
import { getAgentConfig, getProjectConfig } from "../agents/config";
import { BatchProcessor } from "./utils/batchProcessor";

program
  .name("cypress-ai-batch")
  .description("Batch generate Cypress tests for multiple Rally tickets or requirements")
  .version("1.0.0")
  .option("--rally-file <file>", "Text file with one Rally ticket ID/URL per line")
  .option("--manifest <file>", "JSON manifest file with batch items")
  .option("--dry-run", "Generate without writing files")
  .option("--delay <ms>", "Delay between items in ms (default: 2000)", "2000")
  .option("--resume", "Resume from last saved state on failure")
  .option("--mock-rally", "Use mock Rally client (no credentials needed)")
  .option("--state-dir <dir>", "Directory for progress state files", "./.batch-state")
  .parse(process.argv);

const opts = program.opts();

async function main() {
  console.log(chalk.cyan.bold("\n  ╔═══════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("  ║   Cypress AI Batch Test Generator     ║"));
  console.log(chalk.cyan.bold("  ╚═══════════════════════════════════════╝\n"));

  if (!opts.rallyFile && !opts.manifest) {
    console.error(chalk.red("Error: Must provide --rally-file or --manifest"));
    process.exit(1);
  }

  const agentConfig = getAgentConfig();
  const projectConfig = getProjectConfig();

  const processor = new BatchProcessor(agentConfig, projectConfig, {
    delayMs: parseInt(opts.delay),
    dryRun: Boolean(opts.dryRun),
    resumeOnFailure: Boolean(opts.resume),
    stateDir: opts.stateDir,
    mockRally: Boolean(opts.mockRally),
  });

  if (opts.rallyFile) {
    await processor.processRallyTicketFile(opts.rallyFile);
  } else if (opts.manifest) {
    await processor.processManifest(opts.manifest);
  }
}

main().catch((err) => {
  console.error(chalk.red(`\nFatal: ${err.message}`));
  process.exit(1);
});
