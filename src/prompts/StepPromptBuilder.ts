// src/prompts/StepPromptBuilder.ts

import { PromptBuilder }  from './PromptBuilder';
import { CodebaseContext } from '../types';

const SYSTEM = `You are a senior automation engineer implementing Cypress + Cucumber step definitions.

Output: a single valid TypeScript file — no markdown fences, no explanation, no preamble.

Rules:
1. Mirror import paths, page object usage, and helper structure of the example files exactly.
2. Use the same Given/When/Then annotation style as the examples.
3. REUSE EXISTING STEPS — if a step exists in the STEP REGISTRY, add an import, skip reimplementing.
4. Only implement steps NOT found in the STEP REGISTRY.
5. Selector strategy:
   - Reuse selectors from the "Known selectors" list where a step clearly maps to one.
   - For new selectors: cy.get('[data-testid="PLACEHOLDER_kebab-case-name"]')
6. Do NOT introduce npm packages not already in the example files.
7. Add a one-line JSDoc above every NEW step function.
8. If a page object method is needed but absent: // TODO: add <method> to <PageObject>
9. Use the same module export pattern as the example files.`;

export class StepPromptBuilder extends PromptBuilder {
  constructor() {
    super();
    this.addSystem(SYSTEM);
  }

  withStepDefExamples(context: CodebaseContext): this {
    for (const f of context.existingStepDefs) {
      this.addContext('STEP DEFINITION EXAMPLE — replicate this style:', f.relativePath, f.content);
    }
    return this;
  }

  withPageObjects(context: CodebaseContext): this {
    for (const f of context.pageObjects) {
      this.addContext('PAGE OBJECT (method bodies stubbed):', f.relativePath, f.content);
    }
    return this;
  }

  withCommands(context: CodebaseContext): this {
    for (const f of context.cypressCommands) {
      this.addContext('CUSTOM CYPRESS COMMANDS:', f.relativePath, f.content);
    }
    return this;
  }

  withSelectors(context: CodebaseContext): this {
    this.addList(
      'KNOWN data-testid SELECTORS — reuse where a step clearly maps to one:',
      context.sampleSelectors
    );
    return this;
  }

  withStepRegistry(context: CodebaseContext): this {
    this.messages.push({ role: 'user', content: context.stepRegistry.promptBlock });
    return this;
  }

  withTask(featureContent: string): this {
    this.addTask(
      'TASK — implement step definitions for this feature file.\n\n' +
      'Remember: steps in the REGISTRY → import only. Steps not in REGISTRY → implement.\n\n' +
      'Output only the TypeScript file content:\n\n' +
      featureContent
    );
    return this;
  }
}
