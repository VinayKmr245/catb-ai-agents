// src/agents/stepAgent.ts
// Generates new step definitions as structured objects, assembles the file in code

import { AIClient, type ChatMessage } from "../lib/aiClient";
import { STEP_DEFINITIONS_TOOL } from "../lib/tools";
import { AGENT_SYSTEM_PROMPT } from "../config/config";
import type { TestRequirement, ExistingContext, GeneratedStepDefinition, AgentConfig } from "../types";

type GherkinKeyword = "Given" | "When" | "Then";

interface NewStepNeeded {
  keyword: string;
  pattern: string;
  purpose: string;
}

interface StepImplementation {
  keyword: string;
  pattern: string;
  body: string;
}

export class StepAgent {
  private ai: AIClient;

  constructor(config: AgentConfig) {
    this.ai = new AIClient(config);
  }

  async generateSteps(
    requirements: TestRequirement,
    context: ExistingContext,
    contextSummary: string,
    newStepsNeeded: NewStepNeeded[]
  ): Promise<GeneratedStepDefinition> {
    if (newStepsNeeded.length === 0) {
      return { filename: "", content: "", path: "", steps: [] };
    }

    // Normalise And/But → Given/When/Then before sending to the model
    const normalisedSteps = newStepsNeeded.map((s) => ({
      ...s,
      keyword: this.inferKeyword(s.keyword, s.purpose),
    }));

    const messages: ChatMessage[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: this.buildPrompt(requirements, context, contextSummary, normalisedSteps),
      },
    ];

    for (let i = 0; i < this.ai.maxIterations; i++) {
      const result = await this.ai.complete(messages, [STEP_DEFINITIONS_TOOL]);

      if (result.toolCall?.function.name === "write_step_definitions") {
        const input = AIClient.parseArgs<{
          filename: string;
          selectorImport: string;
          selectorFile: string;
          steps: StepImplementation[];
        }>(result.toolCall);

        if (!input) throw new Error("StepAgent: failed to parse tool arguments");

        const content = this.assembleFile(
          input.selectorImport ?? "selectors",
          input.selectorFile ?? input.selectorImport ?? "selectors",
          input.steps ?? []
        );

        return {
          filename: input.filename,
          content,
          path: "",
          steps: (input.steps ?? []).map((s) => s.pattern),
        };
      }

      messages.push(AIClient.assistantMessage(result));
      messages.push({
        role: "user",
        content: "Please call the write_step_definitions tool with the steps array.",
      });
    }

    throw new Error("StepAgent exceeded max iterations");
  }

  // ── File assembly (formatting done here, never trusted from the model) ──

  private assembleFile(
    selectorImport: string,
    selectorFile: string,
    steps: StepImplementation[]
  ): string {
    const usedKeywords = [...new Set(steps.map((s) => this.sanitiseKeyword(s.keyword)))];

    const lines: string[] = [
      `import { ${usedKeywords.join(", ")} } from "@badeball/cypress-cucumber-preprocessor";`,
      `import { ${selectorImport} as sel } from "../../support/selectors/${selectorFile}";`,
      "",
    ];

    for (const step of steps) {
      const keyword = this.sanitiseKeyword(step.keyword);
      const body = this.normaliseBody(step.body);
      lines.push(`${keyword}("${step.pattern}", () => {`);
      // Indent each body line
      body.split("\n").forEach((line) => lines.push(`  ${line}`));
      lines.push(`});`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Unescape literal \\n sequences GPT-4 may emit inside JSON strings,
   * then re-indent each body line consistently.
   */
  private normaliseBody(body: string): string {
    return body
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "  ")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");
  }

  private sanitiseKeyword(keyword: string): GherkinKeyword {
    if (keyword === "Given" || keyword === "When" || keyword === "Then") return keyword;
    return "When";
  }

  /** Map And/But (or anything unexpected) to a semantic keyword using purpose text */
  private inferKeyword(keyword: string, purpose: string): string {
    if (["Given", "When", "Then"].includes(keyword)) return keyword;

    const lower = purpose.toLowerCase();

    if (
      lower.includes("assert") ||
      lower.includes("verify") ||
      lower.includes("should") ||
      lower.includes("check") ||
      lower.includes("see") ||
      lower.includes("display") ||
      lower.includes("redirect") ||
      lower.includes("shown") ||
      lower.includes("visible") ||
      lower.includes("notif") ||
      lower.includes("error") ||
      lower.includes("success")
    ) {
      return "Then";
    }

    if (
      lower.includes("visit") ||
      lower.includes("navigate") ||
      lower.includes("open") ||
      lower.includes("logged") ||
      lower.includes("start") ||
      lower.includes("setup") ||
      lower.includes("exist") ||
      lower.includes("given")
    ) {
      return "Given";
    }

    return "When";
  }

  private buildPrompt(
    requirements: TestRequirement,
    context: ExistingContext,
    contextSummary: string,
    steps: NewStepNeeded[]
  ): string {
    const existingSelectorFiles = context.selectors
      .map((s) => `${s.name} → export: ${s.exportName}`)
      .join("\n");

    return `
${contextSummary}

---

FEATURE: ${requirements.title}

STEPS TO IMPLEMENT:
${steps.map((s) => `  ${s.keyword}  "${s.pattern}"  →  ${s.purpose}`).join("\n")}

AVAILABLE SELECTOR FILES:
${existingSelectorFiles || "None yet — new selectors will be created"}

RULES:
- keyword MUST be Given, When, or Then — never And or But
- body must contain only the inner lines of the function (no wrapping arrow function)
- Use cy.get(sel.keyName) — never hardcode selectors
- Use cy.should(), cy.contains(), cy.url() for assertions

Call write_step_definitions with the structured steps array.
`.trim();
  }
}
