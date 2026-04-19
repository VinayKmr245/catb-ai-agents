// src/lib/tools.ts
// All tool definitions in one place — import what you need per agent

import type { Tool } from "../../azure-agents/azure-agents/aiClient";

export const FEATURE_FILE_TOOL: Tool = {
  type: "function",
  function: {
    name: "write_feature_file",
    description: "Writes a complete Gherkin feature file for the given requirements.",
    parameters: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Filename in kebab-case, e.g. user-login.feature",
        },
        content: {
          type: "string",
          description: "Complete Gherkin feature file content",
        },
        reusedSteps: {
          type: "array",
          items: { type: "string" },
          description: "Existing step patterns that were reused",
        },
        newStepsNeeded: {
          type: "array",
          items: {
            type: "object",
            properties: {
              keyword: { type: "string", enum: ["Given", "When", "Then"] },
              pattern: { type: "string" },
              purpose: { type: "string" },
            },
            required: ["keyword", "pattern", "purpose"],
          },
          description: "New step definitions needed — will be generated next",
        },
      },
      required: ["filename", "content"],
    },
  },
};

export const STEP_DEFINITIONS_TOOL: Tool = {
  type: "function",
  function: {
    name: "write_step_definitions",
    description:
      "Returns each step as a structured object. Do NOT write a full file — return the steps array only.",
    parameters: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Output filename, e.g. passwordResetSteps.ts",
        },
        selectorImport: {
          type: "string",
          description: "Selector export name to import, e.g. passwordResetSelectors",
        },
        selectorFile: {
          type: "string",
          description: "Selector file name without extension, e.g. passwordResetSelectors",
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
                description: "Step pattern exactly as it appears in the feature file",
              },
              body: {
                type: "string",
                description:
                  "Function body lines only — e.g. \"cy.get(sel.submitButton).click();\"",
              },
            },
            required: ["keyword", "pattern", "body"],
          },
        },
      },
      required: ["filename", "selectorImport", "selectorFile", "steps"],
    },
  },
};

export const SELECTOR_ADDITIONS_TOOL: Tool = {
  type: "function",
  function: {
    name: "write_selector_additions",
    description:
      "Adds new selectors to existing selector files or creates new ones. Strictly follows the data-cy pattern.",
    parameters: {
      type: "object",
      properties: {
        additions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              targetFile: {
                type: "string",
                description: "Existing filename to add to, or new filename",
              },
              exportName: {
                type: "string",
                description: "export const name, e.g. loginSelectors",
              },
              isNewFile: {
                type: "boolean",
                description: "True if creating a new file",
              },
              newSelectors: {
                type: "object",
                description: "camelCase key → '[data-cy=\"kebab-value\"]' pairs",
                additionalProperties: { type: "string" },
              },
            },
            required: ["targetFile", "exportName", "isNewFile", "newSelectors"],
          },
        },
      },
      required: ["additions"],
    },
  },
};

export const REVIEW_TOOL: Tool = {
  type: "function",
  function: {
    name: "review_output",
    description: "Reviews generated Cypress test files and reports issues. Returns only short descriptions — no file content.",
    parameters: {
      type: "object",
      properties: {
        approved: {
          type: "boolean",
          description: "True if no critical issues were found",
        },
        issues: {
          type: "array",
          items: { type: "string" },
          description: "Critical issues — one short sentence each",
        },
        suggestions: {
          type: "array",
          items: { type: "string" },
          description: "Non-blocking improvement suggestions",
        },
        featureNeedsFix: {
          type: "boolean",
          description: "True if the feature file has errors",
        },
        stepsNeedFix: {
          type: "boolean",
          description: "True if step definitions have errors",
        },
      },
      required: ["approved", "issues", "suggestions", "featureNeedsFix", "stepsNeedFix"],
    },
  },
};

export const FIX_TOOL: Tool = {
  type: "function",
  function: {
    name: "provide_fix",
    description: "Returns the fully corrected file content.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The complete corrected file content",
        },
      },
      required: ["content"],
    },
  },
};

export const EXTRACT_REQUIREMENTS_TOOL: Tool = {
  type: "function",
  function: {
    name: "extract_requirements",
    description:
      "Extracts structured test requirements from raw Rally ticket data.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Clean feature title" },
        description: { type: "string", description: "One-sentence feature description" },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "Testable acceptance criteria statements",
        },
        userStories: {
          type: "array",
          items: { type: "string" },
          description: "User story sentences (As a... I want... So that...)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Feature tags for categorisation",
        },
      },
      required: ["title", "description", "acceptanceCriteria", "userStories", "tags"],
    },
  },
};

export const PARSE_TEXT_TOOL: Tool = {
  type: "function",
  function: {
    name: "parse_text_requirements",
    description: "Parses free-form text into structured test requirements.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        userStories: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        ambiguities: {
          type: "array",
          items: { type: "string" },
          description: "Unclear or missing details a tester should clarify",
        },
      },
      required: ["title", "description", "acceptanceCriteria", "userStories", "tags", "ambiguities"],
    },
  },
};
