// src/prompts/SelectorPromptBuilder.ts

import { PromptBuilder } from './PromptBuilder';

const SYSTEM = `You are a frontend developer reviewing auto-generated Cypress step definitions.

Output: a valid JSON array only — no markdown fences, no explanation, no trailing commas.

Each item must have exactly:
  "placeholder"     — the full PLACEHOLDER_xxx string from the step definitions
  "suggestedTestId" — the kebab-case data-testid value (no PLACEHOLDER_ prefix)
  "elementHint"     — short description, e.g. "<button> that submits the form"`;

export class SelectorPromptBuilder extends PromptBuilder {
  constructor() {
    super();
    this.addSystem(SYSTEM);
  }

  withStepContent(stepContent: string): this {
    this.messages.push({
      role:    'user',
      content: `GENERATED STEP DEFINITIONS — find every PLACEHOLDER_ selector:\n\n${stepContent}`,
    });
    return this;
  }

  withComponentDescription(description: string): this {
    this.addTask(
      `NEW COMPONENT:\n${description}\n\n` +
      `For each PLACEHOLDER_ found above, output one JSON object with the correct ` +
      `data-testid and the element it belongs to.`
    );
    return this;
  }
}
