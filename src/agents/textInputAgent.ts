// src/agents/textInputAgent.ts
// Parses free-form text requirements when Rally is unavailable

import { AIClient } from "../lib/aiClient";
import { PARSE_TEXT_TOOL } from "../lib/tools";
import type { TestRequirement, AgentConfig } from "../types";

export class TextInputAgent {
  private ai: AIClient;

  constructor(config: AgentConfig) {
    this.ai = new AIClient(config);
  }

  async parseRequirements(text: string): Promise<TestRequirement> {
    const prompt = `
You are a QA analyst parsing free-form feature requirements for Cypress E2E test generation.

INPUT TEXT:
${text}

Tasks:
1. Infer a concise feature title and description
2. Extract clear, testable acceptance criteria (one statement per item)
3. Form proper user stories if not present
4. Suggest relevant tags
5. Flag any ambiguities or missing details

Call parse_text_requirements with your analysis.
`.trim();

    const result = await this.ai.complete(
      [{ role: "user", content: prompt }],
      [PARSE_TEXT_TOOL],
      2048
    );

    if (result.toolCall?.function.name === "parse_text_requirements") {
      const input = AIClient.parseArgs<{
        title: string;
        description: string;
        acceptanceCriteria: string[];
        userStories: string[];
        tags: string[];
        ambiguities: string[];
      }>(result.toolCall);

      if (!input) throw new Error("TextInputAgent: failed to parse tool arguments");

      if (input.ambiguities.length > 0) {
        console.warn("\n⚠  Ambiguities detected in input:");
        input.ambiguities.forEach((a) => console.warn(`   • ${a}`));
        console.warn("  Tests will be generated with best-effort assumptions.\n");
      }

      return {
        source: "text",
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        userStories: input.userStories,
        tags: input.tags,
        rawContent: text,
      };
    }

    throw new Error("TextInputAgent: model did not call parse_text_requirements tool");
  }
}
