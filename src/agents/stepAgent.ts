// src/agents/stepAgent.ts
// Agent that generates ONLY new step definitions, never duplicating existing ones

import Groq from "groq-sdk";
import type {
  TestRequirement,
  ExistingContext,
  GeneratedStepDefinition,
  AgentConfig,
} from "../types";
import { AGENT_SYSTEM_PROMPT } from "../config/config";

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

// Ask the model to return each step as a structured object — NOT as a pre-formatted file.
// We assemble the file ourselves in TypeScript so formatting is always correct.
const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "write_step_definitions",
      description: "Returns each step definition as a structured object. Do NOT write a full file — just return the array of steps with their implementation bodies.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Output filename, e.g. passwordResetSteps.ts",
          },
          selectorImport: {
            type: "string",
            description: "The selector export name to import, e.g. passwordResetSelectors",
          },
          selectorFile: {
            type: "string",
            description: "The selector file path relative to support/selectors, e.g. passwordResetSelectors",
          },
          steps: {
            type: "array",
            description: "Each step to implement",
            items: {
              type: "object",
              properties: {
                keyword: {
                  type: "string",
                  enum: ["Given", "When", "Then"],
                  description: "ONLY Given, When, or Then — never And or But",
                },
                pattern: {
                  type: "string",
                  description: "The step pattern string exactly as it appears in the feature file",
                },
                body: {
                  type: "string",
                  description: "The function body — just the inner lines, e.g. \"cy.get(sel.submitButton).click();\"",
                },
              },
              required: ["keyword", "pattern", "body"],
            },
          },
        },
        required: ["filename", "selectorImport", "selectorFile", "steps"],
      },
    },
  },
];

export class StepAgent {
  private client: Groq;

  constructor(private config: AgentConfig) {
    this.client = new Groq({ apiKey: config.apiKey });
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

    const existingSelectorFiles = context.selectors
      .map((s) => `${s.name} → export: ${s.exportName}`)
      .join("\n");

    // Normalise And/But → Given/When/Then before sending to the model
    const normalisedSteps = newStepsNeeded.map((s) => ({
      ...s,
      keyword:
        s.keyword === "And" || s.keyword === "But"
          ? this.inferKeyword(s.purpose)
          : s.keyword,
    }));

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: AGENT_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `
${contextSummary}

---

FEATURE: ${requirements.title}

STEPS TO IMPLEMENT:
${normalisedSteps.map((s) => `  ${s.keyword}  "${s.pattern}"  →  ${s.purpose}`).join("\n")}

AVAILABLE SELECTOR FILES:
${existingSelectorFiles || "None yet — new selectors will be created"}

RULES:
- keyword must be Given, When, or Then — NEVER And or But
- body must be only the inner lines of the function (no wrapping arrow function)
- Use cy.get(sel.keyName) — never hardcode selectors inline
- Use cy.should(), cy.contains(), cy.url() for assertions

Call write_step_definitions with the structured steps array.
`.trim(),
      },
    ];

    for (let i = 0; i < this.config.maxIterations; i++) {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        tools: TOOLS,
        messages,
      });

      const message = response.choices[0].message;
      const toolCall = message.tool_calls?.[0];

      if (toolCall?.type === "function" && toolCall.function.name === "write_step_definitions") {
        const input = JSON.parse(toolCall.function.arguments) as {
          filename: string;
          selectorImport: string;
          selectorFile: string;
          steps: StepImplementation[];
        };

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

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      });
      messages.push({
        role: "user",
        content: "Please call the write_step_definitions tool with the steps array.",
      });
    }

    throw new Error("Step agent exceeded max iterations");
  }

  /**
   * Assemble the final .ts file from structured step objects.
   * Formatting is done here in TypeScript — never trusted from the model.
   */
  private assembleFile(
    selectorImport: string,
    selectorFile: string,
    steps: StepImplementation[]
  ): string {
    // Determine which keywords are actually used
    const usedKeywords = [...new Set(
      steps.map((s) => this.sanitiseKeyword(s.keyword))
    )];
    const importKeywords = usedKeywords.join(", ");

    const lines: string[] = [
      `import { ${importKeywords} } from "@badeball/cypress-cucumber-preprocessor";`,
      `import { ${selectorImport} as sel } from "../../support/selectors/${selectorFile}";`,
      "",
    ];

    for (const step of steps) {
      const keyword = this.sanitiseKeyword(step.keyword);
      // Normalise the body — unescape literal \n, trim, indent
      const body = this.normaliseBody(step.body);
      lines.push(`${keyword}("${step.pattern}", () => {`);
      lines.push(`  ${body}`);
      lines.push(`});`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Unescape literal \\n sequences the model may have emitted,
   * trim whitespace, and re-indent each line with 2 spaces.
   */
  private normaliseBody(body: string): string {
    return body
      .replace(/\\n/g, "\n")       // unescape literal \n
      .replace(/\\t/g, "  ")        // unescape literal \t
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n  ");                 // re-indent with 2 spaces
  }

  /** Ensure keyword is always Given/When/Then, never And/But */
  private sanitiseKeyword(keyword: string): "Given" | "When" | "Then" {
    if (keyword === "Given" || keyword === "When" || keyword === "Then") {
      return keyword;
    }
    return "When";
  }

  /** Infer Given/When/Then from a step's purpose when keyword was And/But */
  private inferKeyword(purpose: string): string {
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
      lower.includes("notif")
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
      lower.includes("exist")
    ) {
      return "Given";
    }
    return "When";
  }
}
