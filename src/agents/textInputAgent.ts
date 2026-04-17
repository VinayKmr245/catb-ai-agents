// src/agents/textInputAgent.ts
// Fallback agent: parses free-form text input when Rally is unavailable

import Groq from "groq-sdk";
import type { TestRequirement, AgentConfig } from "../types";

const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "parse_text_requirements",
      description:
        "Parses free-form text describing a feature or user story into structured test requirements.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "A concise feature title derived from the text",
          },
          description: {
            type: "string",
            description: "One-sentence summary of what needs to be tested",
          },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
            description:
              "Individual testable acceptance criteria inferred from the text",
          },
          userStories: {
            type: "array",
            items: { type: "string" },
            description: "User story sentences derived or inferred from the text",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Relevant tags/labels for this feature",
          },
          ambiguities: {
            type: "array",
            items: { type: "string" },
            description:
              "Anything unclear or missing from the input that a tester should clarify",
          },
        },
        required: [
          "title",
          "description",
          "acceptanceCriteria",
          "userStories",
          "tags",
          "ambiguities",
        ],
      },
    },
  },
];

export class TextInputAgent {
  private client: Groq;

  constructor(private config: AgentConfig) {
    this.client = new Groq({ apiKey: config.apiKey });
  }

  async parseRequirements(text: string): Promise<TestRequirement> {
    const prompt = `
You are a QA analyst parsing free-form feature requirements for Cypress E2E test generation.

INPUT TEXT:
${text}

Your task:
1. Infer the feature title and description
2. Extract or derive clear, testable acceptance criteria (one statement per item)
3. Form proper user stories if not already present
4. Suggest relevant tags
5. Flag any ambiguities or missing details

Call the parse_text_requirements tool with your analysis.
`.trim();

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: 2048,
      tools: TOOLS,
      messages: [{ role: "user", content: prompt }],
    });

    const message = response.choices[0].message;
    const toolCall = message.tool_calls?.[0];

    if (!toolCall || toolCall.type !== "function") {
      throw new Error("Text agent did not call parse_text_requirements tool");
    }

    const input = JSON.parse(toolCall.function.arguments) as {
      title: string;
      description: string;
      acceptanceCriteria: string[];
      userStories: string[];
      tags: string[];
      ambiguities: string[];
    };

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
}
