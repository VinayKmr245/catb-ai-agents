// src/agents/rallyAgent.ts
// Extracts structured requirements from Rally tickets

import { AIClient } from "../lib/aiClient";
import { EXTRACT_REQUIREMENTS_TOOL } from "../lib/tools";
import type { RallyTicket, TestRequirement, AgentConfig } from "../types";

export class RallyAgent {
  private ai: AIClient;

  constructor(config: AgentConfig) {
    this.ai = new AIClient(config);
  }

  async extractRequirements(ticket: RallyTicket): Promise<TestRequirement> {
    const prompt = `
Analyse this Rally ticket and extract structured test requirements.

TICKET:
ID: ${ticket.formattedId}
Title: ${ticket.name}
State: ${ticket.state}
Tags: ${ticket.tags.join(", ")}

Description:
${ticket.description}

Acceptance Criteria:
${ticket.acceptanceCriteria}

Test Cases / Notes:
${ticket.testCases.join("\n")}

Break down compound acceptance criteria into individual testable statements.
Call extract_requirements with the structured data.
`.trim();

    const result = await this.ai.complete(
      [{ role: "user", content: prompt }],
      [EXTRACT_REQUIREMENTS_TOOL],
      2048
    );

    if (result.toolCall?.function.name === "extract_requirements") {
      const input = AIClient.parseArgs<{
        title: string;
        description: string;
        acceptanceCriteria: string[];
        userStories: string[];
        tags: string[];
      }>(result.toolCall);

      if (!input) throw new Error("RallyAgent: failed to parse tool arguments");

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

    throw new Error("RallyAgent: model did not call extract_requirements tool");
  }
}
