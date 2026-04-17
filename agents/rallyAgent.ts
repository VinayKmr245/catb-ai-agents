// src/agents/rallyAgent.ts
// Agent responsible for extracting structured requirements from Rally tickets

import Anthropic from "@anthropic-ai/sdk";
import type { RallyTicket, TestRequirement, AgentConfig } from "../types";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "extract_requirements",
    description:
      "Extracts structured test requirements from raw Rally ticket data. Parses acceptance criteria, identifies test scenarios, and normalises the content for test generation.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Clean feature title for the test" },
        description: { type: "string", description: "One-sentence feature description" },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "List of testable acceptance criteria statements",
        },
        userStories: {
          type: "array",
          items: { type: "string" },
          description: "User story sentences (As a... I want... So that...)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Feature tags/labels for categorization",
        },
      },
      required: ["title", "description", "acceptanceCriteria", "userStories", "tags"],
    },
  },
];

export class RallyAgent {
  private client: Anthropic;

  constructor(private config: AgentConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async extractRequirements(ticket: RallyTicket): Promise<TestRequirement> {
    const prompt = `
You are analysing a Rally ticket to extract structured test requirements.

TICKET DATA:
ID: ${ticket.formattedId}
Title: ${ticket.name}
State: ${ticket.state}
Tags: ${ticket.tags.join(", ")}

Description:
${ticket.description}

Acceptance Criteria:
${ticket.acceptanceCriteria}

Additional Notes/Test Cases from ticket:
${ticket.testCases.join("\n")}

Extract all testable requirements. Break down compound acceptance criteria into individual testable statements.
Call the extract_requirements tool with the structured data.
`.trim();

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 2048,
      tools: TOOLS,
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Rally agent did not call extract_requirements tool");
    }

    const input = toolUse.input as {
      title: string;
      description: string;
      acceptanceCriteria: string[];
      userStories: string[];
      tags: string[];
    };

    return {
      source: "rally",
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      userStories: input.userStories,
      tags: input.tags,
      rawContent: `${ticket.name}\n\n${ticket.description}\n\n${ticket.acceptanceCriteria}`,
    };
  }
}
