// src/prompts/FeaturePromptBuilder.ts

import { PromptBuilder }  from './PromptBuilder';
import { CodebaseContext } from '../types';

const SYSTEM = `You are a senior QA engineer who writes Cucumber Gherkin feature files.

Output: a single valid .feature file — no markdown fences, no explanation, no preamble.

Rules:
1. Mirror the tag style of example files exactly (@smoke, @regression, @featureName).
2. Mirror indentation and blank-line style of example files exactly.
3. Use Background: only if two or more scenarios share identical Given steps.
4. Use Scenario Outline + Examples table when steps involve data variations.
5. Write natural, readable step text — no technical jargon in Gherkin lines.
6. Do NOT invent steps not implied by the provided description and test steps.`;

export class FeaturePromptBuilder extends PromptBuilder {
  constructor() {
    super();
    this.addSystem(SYSTEM);
  }

  withExistingFeatures(context: CodebaseContext): this {
    for (const f of context.existingFeatures) {
      this.addContext('EXISTING FEATURE FILE — match this style:', f.relativePath, f.content);
    }
    return this;
  }

  withTask(featureName: string, description: string, testSteps: string): this {
    this.addTask(
      `TASK — write the Gherkin feature file.\n\n` +
      `Feature name : ${featureName}\n` +
      `Description  : ${description}\n\n` +
      `Test steps:\n${testSteps}\n\n` +
      `The Feature: line must read: Feature: ${featureName}`
    );
    return this;
  }
}
