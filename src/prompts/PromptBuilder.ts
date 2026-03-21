// src/prompts/PromptBuilder.ts
//
// Design pattern: Builder (fluent interface) — constructs messages[] arrays
// through a chainable API instead of manual array pushes.
//
// Architecture fix: replaces the procedural prompt functions with a
// composable class hierarchy that is easy to test, extend, and read.

import { ChatMessage } from '../types';

export abstract class PromptBuilder {
  protected readonly messages: ChatMessage[] = [];

  /** Add the static system instruction message */
  protected addSystem(content: string): this {
    this.messages.push({ role: 'system', content });
    return this;
  }

  /** Add a labeled context block as a user message */
  addContext(label: string, filePath: string, content: string): this {
    this.messages.push({
      role:    'user',
      content: `${label}\nFile: ${filePath}\n\n${content}`,
    });
    return this;
  }

  /** Add a compact list as a user message */
  addList(label: string, items: string[]): this {
    if (items.length === 0) return this;
    this.messages.push({
      role:    'user',
      content: `${label}\n\n${items.map(i => `  • ${i}`).join('\n')}`,
    });
    return this;
  }

  /** Add the task message — always call this last */
  addTask(content: string): this {
    this.messages.push({ role: 'user', content });
    return this;
  }

  /** Return the finished messages array */
  build(): ChatMessage[] {
    return [...this.messages];
  }

  /** Estimated token count (~4 chars per token) */
  estimatedTokens(): number {
    return Math.ceil(
      this.messages.reduce((sum, m) => sum + m.content.length, 0) / 4
    );
  }
}
