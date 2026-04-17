// src/agents/featureAgent.ts
// Agent that generates Gherkin feature files from requirements + existing context

import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentConfig,
  ExistingContext,
  GeneratedFeature,
  TestRequirement,
} from "../src/types";
import { AGENT_SYSTEM_PROMPT } from "./config";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "write_feature_file",
    description: "Writes a complete Gherkin feature file for the given requirements.",
    input_schema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Filename in camelCase or kebab-case, e.g. userLogin.feature",
        },
        content: {
          type: "string",
          description: "Complete Gherkin feature file content",
        },
        reusedSteps: {
          type: "array",
          items: { type: "string" },
          description: "List of existing step patterns that were reused",
        },
        newStepsNeeded: {
          type: "array",
          items: {
            type: "object",
            properties: {
              keyword: { type: "string" },
              pattern: { type: "string" },
              purpose: { type: "string" },
            },
            required: ["keyword", "pattern", "purpose"],
          },
          description: "New step definitions that will need to be created",
        },
      },
      required: ["filename", "content", "reusedSteps", "newStepsNeeded"],
    },
  },
];

export class FeatureAgent {
  private client: Anthropic;

  constructor(private config: AgentConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async generateFeature(
    requirements: TestRequirement,
    context: ExistingContext,
    contextSummary: string
  ): Promise<GeneratedFeature & { reusedSteps: string[]; newStepsNeeded: Array<{keyword: string; pattern: string; purpose: string}> }> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `
${contextSummary}

---

REQUIREMENTS TO TEST:
Title: ${requirements.title}
Description: ${requirements.description}
Source: ${requirements.source}
Tags: ${requirements.tags.join(", ")}

User Stories:
${requirements.userStories.map((s) => `  - ${s}`).join("\n")}

Acceptance Criteria:
${requirements.acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

TASK: Generate a complete Gherkin feature file.
- REUSE existing step definitions wherever possible (listed above)
- Note which new steps you need — they will be generated next
- Use Background for repeated setup steps
- Cover happy paths, edge cases and error scenarios
- Each scenario must be independent
- Tag the feature and scenarios with @${requirements.tags.join(" @")}

Call write_feature_file with your output.
`.trim(),
      },
    ];

    // Agentic loop — allow the model to think before calling the tool
    for (let i = 0; i < this.config.maxIterations; i++) {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: AGENT_SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        const input = toolUse.input as {
          filename: string;
          content: string;
          reusedSteps: string[];
          newStepsNeeded: Array<{keyword: string; pattern: string; purpose: string}>;
        };
        return {
          filename: input.filename,
          content: input.content,
          path: `${requirements.title.replace(/\s+/g, "-").toLowerCase()}/`,
          reusedSteps: input.reusedSteps,
          newStepsNeeded: input.newStepsNeeded,
        };
      }

      // If model returned text, push it and continue
      const textContent = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("\n");

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: "Please now call the write_feature_file tool with your feature file.",
      });
    }

    throw new Error("Feature agent exceeded max iterations without calling tool");
  }
}
