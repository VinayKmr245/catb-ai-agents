// src/agents/selectorAgent.ts
// Agent that generates ONLY new selectors, strictly following existing patterns

import Anthropic from "@anthropic-ai/sdk";
import type {
  TestRequirement,
  ExistingContext,
  GeneratedSelectorAdditions,
  AgentConfig,
} from "../types";
import { AGENT_SYSTEM_PROMPT } from "../config/config";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "write_selector_additions",
    description:
      "Adds new selectors to existing selector files or creates new selector files. Strictly follows the data-cy pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        additions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              targetFile: {
                type: "string",
                description:
                  "Existing file to add to (e.g. loginSelectors.ts) or new filename",
              },
              exportName: {
                type: "string",
                description: "The export const name (e.g. loginSelectors)",
              },
              isNewFile: {
                type: "boolean",
                description: "True if creating a new selector file",
              },
              newSelectors: {
                type: "object",
                description: "Key-value pairs of selector name to data-cy selector string",
                additionalProperties: { type: "string" },
              },
              patchContent: {
                type: "string",
                description:
                  "For new files: the complete file content. For existing: the lines to add inside the object.",
              },
            },
            required: [
              "targetFile",
              "exportName",
              "isNewFile",
              "newSelectors",
              "patchContent",
            ],
          },
        },
      },
      required: ["additions"],
    },
  },
];

export class SelectorAgent {
  private client: Anthropic;

  constructor(private config: AgentConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async generateSelectors(
    requirements: TestRequirement,
    context: ExistingContext,
    stepContent: string
  ): Promise<GeneratedSelectorAdditions[]> {
    // Find which selectors are referenced in the generated steps but don't exist
    const referencedSelectors = this.extractReferencedSelectors(stepContent);
    const existingKeys = new Set(
      context.selectors.flatMap((s) => Object.keys(s.selectors))
    );

    const missingSelectors = referencedSelectors.filter(
      (s) => !existingKeys.has(s.key)
    );

    if (missingSelectors.length === 0) return [];

    const existingFileSummary = context.selectors
      .map(
        (s) =>
          `File: ${s.name}\nexport const ${s.exportName} = {\n  ${Object.entries(s.selectors)
            .map(([k, v]) => `${k}: '${v}'`)
            .join(",\n  ")}\n}`
      )
      .join("\n\n");

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `
EXISTING SELECTOR FILES:
${existingFileSummary || "None"}

FEATURE: ${requirements.title}

GENERATED STEP CONTENT (needing selectors):
${stepContent}

MISSING SELECTORS DETECTED:
${missingSelectors.map((s) => `  ${s.selectorFile}.${s.key}`).join("\n")}

RULES:
1. ALL selectors MUST use '[data-cy="..."]' format — no exceptions
2. Selector keys must be camelCase descriptive names
3. Group selectors by page/component (add to existing file if appropriate)
4. data-cy values should be kebab-case, descriptive, and unique
5. If a new file is needed, name it <featureName>Selectors.ts
6. Export name must match filename: loginSelectors.ts → export const loginSelectors

EXAMPLE OF CORRECT OUTPUT:
export const loginSelectors = {
  usernameInput: '[data-cy="username-input"]',
  passwordInput: '[data-cy="password-input"]',
  submitButton: '[data-cy="login-submit-btn"]',
  errorMessage: '[data-cy="login-error-msg"]',
};

Call write_selector_additions with your output.
`.trim(),
      },
    ];

    for (let i = 0; i < this.config.maxIterations; i++) {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 2048,
        system: AGENT_SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        const input = toolUse.input as {
          additions: Array<{
            targetFile: string;
            exportName: string;
            isNewFile: boolean;
            newSelectors: Record<string, string>;
            patchContent: string;
          }>;
        };

        return input.additions.map((a) => ({
          targetFile: a.targetFile,
          exportName: a.exportName,
          additions: a.newSelectors,
          patchContent: a.patchContent,
        }));
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: "Please call the write_selector_additions tool.",
      });
    }

    return [];
  }

  private extractReferencedSelectors(
    stepContent: string
  ): Array<{ selectorFile: string; key: string }> {
    const results: Array<{ selectorFile: string; key: string }> = [];
    // Match patterns like: sel.keyName or loginSelectors.keyName
    const matches = stepContent.matchAll(/(?:sel|(\w+Selectors))\.(\w+)/g);
    for (const m of matches) {
      results.push({
        selectorFile: m[1] || "sel",
        key: m[2],
      });
    }
    return results;
  }
}
