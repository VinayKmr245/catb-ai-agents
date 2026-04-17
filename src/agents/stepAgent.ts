// src/agents/stepAgent.ts
// Agent that generates ONLY new step definitions, never duplicating existing ones

import Groq from "groq-sdk";
import { AGENT_SYSTEM_PROMPT } from "../../agents/config";
import type {
    AgentConfig,
    ExistingContext,
    GeneratedStepDefinition,
    TestRequirement,
} from "../types";

interface NewStepNeeded {
  keyword: string;
  pattern: string;
  purpose: string;
}

const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "write_step_definitions",
      description:
        "Writes new Cypress step definition implementations. Only creates steps that don't already exist.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "e.g. loginSteps.ts",
          },
          content: {
            type: "string",
            description: "Full TypeScript step definition file content",
          },
          implementedSteps: {
            type: "array",
            items: { type: "string" },
            description: "The step patterns implemented in this file",
          },
          selectorImportsNeeded: {
            type: "array",
            items: { type: "string" },
            description: "Selector file names that need to be imported (e.g. loginSelectors)",
          },
        },
        required: ["filename", "content", "implementedSteps", "selectorImportsNeeded"],
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
      return {
        filename: "",
        content: "",
        path: "",
        steps: [],
      };
    }

    const existingSelectorFiles = context.selectors
      .map((s) => `${s.name} → export: ${s.exportName}`)
      .join("\n");

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

NEW STEPS TO IMPLEMENT:
${newStepsNeeded.map((s) => `  ${s.keyword}("${s.pattern}") — ${s.purpose}`).join("\n")}

AVAILABLE SELECTOR FILES:
${existingSelectorFiles || "None yet — new selectors will be added"}

RULES:
1. Only implement the listed new steps above
2. Import selectors from their existing files (or a new one to be created)
3. Use cy.get(sel.keyName) pattern — never hardcode selectors inline
4. Follow the exact TypeScript pattern shown in the system prompt
5. Each step must be atomic and single-responsibility
6. Use proper Cypress assertions: cy.should(), cy.contains(), cy.url()

Call write_step_definitions with the implementation.
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
          content: string;
          implementedSteps: string[];
          selectorImportsNeeded: string[];
        };

        return {
          filename: input.filename,
          content: input.content,
          path: "",
          steps: input.implementedSteps,
        };
      }

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      });
      messages.push({
        role: "user",
        content: "Please call the write_step_definitions tool with your implementation.",
      });
    }

    throw new Error("Step agent exceeded max iterations");
  }
}
