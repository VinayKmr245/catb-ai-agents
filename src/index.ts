// src/index.ts
// CLI entry point — supports both Rally URL mode and free-text fallback

import chalk from "chalk";
import { program } from "commander";
import * as fs from "fs";
import inquirer from "inquirer";
import * as path from "path";
import { Orchestrator } from "./agents/orchestrator";
import { TextInputAgent } from "./agents/textInputAgent";
import { getAgentConfig, getProjectConfig } from "./config/config";
// import { MockRallyClient, RallyClient } from "./tools/rallyTool";
import type { TestRequirement } from "./types";
import { FileWriter } from "./utils/fileWriter";

program
  .name("cypress-ai-agent")
  .description("AI-powered Cypress Cucumber test generator")
  .version("1.0.0")
  .option("--mode <mode>", "Input mode: rally | text | interactive", "interactive")
  .option("--rally-url <url>", "Rally ticket URL or ID (e.g. US12345)")
  .option("--text <text>", "Free-form requirements text")
  .option("--text-file <file>", "Path to a text file with requirements")
  .option("--dry-run", "Generate files without writing to disk")
  .option("--preview-dir <dir>", "Write output to preview directory instead of project")
  .option("--mock-rally", "Use mock Rally client (for testing without credentials)")
  .parse(process.argv);

const opts = program.opts();

async function main() {
  printBanner();

  const agentConfig = getAgentConfig();
  const projectConfig = getProjectConfig();

  let requirements: TestRequirement;
  const mode = await resolveMode();

  // if (mode === "rally") {
  //   requirements = TestRequirement(); // Placeholder until Rally integration is implemented
  //   // requirements = await handleRallyMode(agentConfig, projectConfig);
  // } else {
  // }
  requirements = await handleTextMode(agentConfig);

  const orchestrator = new Orchestrator(agentConfig, projectConfig);
  const dryRun = Boolean(opts.dryRun);
  const output = await orchestrator.generate(requirements, dryRun);

  if (opts.previewDir) {
    const writer = new FileWriter(projectConfig);
    const written = await writer.writePreview(output, path.resolve(opts.previewDir));
    console.log(chalk.cyan("\nPreview files written:"));
    written.created.forEach((f) => console.log(chalk.gray(`  ${f}`)));
  }
}

async function resolveMode(): Promise<"rally" | "text"> {
  if (opts.mode === "rally" || opts.rallyUrl) return "rally";
  if (opts.mode === "text" || opts.text || opts.textFile) return "text";

  // Interactive mode — ask the user
  const { mode } = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "How would you like to provide requirements?",
      choices: [
        { name: "Rally ticket URL / ID", value: "rally" },
        { name: "Free-form text input", value: "text" },
        { name: "Load from text file", value: "file" },
      ],
    },
  ]);

  if (mode === "file") {
    const { filePath } = await inquirer.prompt([
      {
        type: "input",
        name: "filePath",
        message: "Path to requirements file:",
        validate: (v) => (fs.existsSync(v) ? true : "File not found"),
      },
    ]);
    opts.textFile = filePath;
    return "text";
  }

  return mode;
}

// async function handleRallyMode(
//   agentConfig: ReturnType<typeof getAgentConfig>,
//   projectConfig: ReturnType<typeof getProjectConfig>
// ): Promise<TestRequirement> {
//   let rallyInput = opts.rallyUrl as string;

//   if (!rallyInput) {
//     const { url } = await inquirer.prompt([
//       {
//         type: "input",
//         name: "url",
//         message: "Enter Rally ticket URL or ID (e.g. US12345 or full URL):",
//         validate: (v) => (v.trim() ? true : "Please enter a Rally ticket ID"),
//       },
//     ]);
//     rallyInput = url;
//   }

//   console.log(chalk.gray(`\n  Fetching Rally ticket: ${rallyInput}`));

//   // const rallyClient = opts.mockRally
//   //   ? new MockRallyClient()
//   //   : new RallyClient(projectConfig);

//   // const ticket = await rallyClient.fetchTicket(rallyInput);
//   // console.log(chalk.green(`  ✓ Fetched: [${ticket.formattedId}] ${ticket.name}`));

//   // const rallyAgent = new RallyAgent(agentConfig);
//   // return rallyAgent.extractRequirements(ticket);
// }

async function handleTextMode(
  agentConfig: ReturnType<typeof getAgentConfig>
): Promise<TestRequirement> {
  let text = opts.text as string;

  if (!text && opts.textFile) {
    text = fs.readFileSync(path.resolve(opts.textFile), "utf-8");
    console.log(chalk.gray(`  Loaded requirements from: ${opts.textFile}`));
  }

  if (!text) {
    console.log(
      chalk.gray("\n  Enter your requirements (press Enter twice when done):\n")
    );
    const lines: string[] = [];
    const { content } = await inquirer.prompt([
      {
        type: "editor",
        name: "content",
        message: "Requirements",
      },
    ]);
    text = content;
  }

  if (!text.trim()) throw new Error("No requirements text provided");

  const textAgent = new TextInputAgent(agentConfig);
  return textAgent.parseRequirements(text);
}

function printBanner() {
  console.log(chalk.cyan.bold("\n  ╔═══════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("  ║      Cypress AI Test Generator        ║"));
  console.log(chalk.cyan.bold("  ║   Rally + Text → Feature + Steps      ║"));
  console.log(chalk.cyan.bold("  ╚═══════════════════════════════════════╝\n"));
}

main().catch((err) => {
  console.error(chalk.red(`\n  Fatal error: ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
