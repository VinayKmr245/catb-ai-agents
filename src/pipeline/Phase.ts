// src/pipeline/Phase.ts
//
// Design pattern: Strategy — each generation phase is a self-contained
// unit that implements a common interface.
// The Agent runs phases sequentially, passing outputs between them.

import { CodebaseContext, AgentInput, PhaseResult, SelectorSuggestion } from '../types';
import { LLMClient }              from '../services/LLMClient';
import { FeaturePromptBuilder }   from '../prompts/FeaturePromptBuilder';
import { StepPromptBuilder }      from '../prompts/StepPromptBuilder';
import { SelectorPromptBuilder }  from '../prompts/SelectorPromptBuilder';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface Phase<TInput, TOutput> {
  readonly name: string;
  run(input: TInput, llm: LLMClient): Promise<TOutput>;
}

// ─── Phase 1: Feature generation ─────────────────────────────────────────────

export interface FeaturePhaseInput {
  agentInput: AgentInput;
  context:    CodebaseContext;
}

export class FeaturePhase implements Phase<FeaturePhaseInput, PhaseResult> {
  readonly name = 'feature';

  async run(input: FeaturePhaseInput, llm: LLMClient): Promise<PhaseResult> {
    const { agentInput, context } = input;

    const builder = new FeaturePromptBuilder()
      .withExistingFeatures(context)
      .withTask(agentInput.featureName, agentInput.description, agentInput.testSteps);

    const messages = builder.build();
    const content  = await llm.complete(messages, 0.2);

    return {
      phaseName:       this.name,
      content,
      messagesUsed:    messages.length,
      estimatedTokens: builder.estimatedTokens(),
    };
  }
}

// ─── Phase 2: Step definition generation ─────────────────────────────────────

export interface StepPhaseInput {
  context:        CodebaseContext;
  featureContent: string;
}

export class StepPhase implements Phase<StepPhaseInput, PhaseResult> {
  readonly name = 'stepDefs';

  async run(input: StepPhaseInput, llm: LLMClient): Promise<PhaseResult> {
    const { context, featureContent } = input;

    const builder = new StepPromptBuilder()
      .withStepDefExamples(context)
      .withPageObjects(context)
      .withCommands(context)
      .withSelectors(context)
      .withStepRegistry(context)
      .withTask(featureContent);

    const messages = builder.build();
    const content  = await llm.complete(messages, 0.1);

    return {
      phaseName:       this.name,
      content,
      messagesUsed:    messages.length,
      estimatedTokens: builder.estimatedTokens(),
    };
  }
}

// ─── Phase 3: Selector resolution (optional) ─────────────────────────────────

export interface SelectorPhaseInput {
  stepContent:          string;
  componentDescription: string;
}

export interface SelectorPhaseOutput extends PhaseResult {
  suggestions: SelectorSuggestion[];
}

export class SelectorPhase implements Phase<SelectorPhaseInput, SelectorPhaseOutput> {
  readonly name = 'selectors';

  async run(input: SelectorPhaseInput, llm: LLMClient): Promise<SelectorPhaseOutput> {
    const { stepContent, componentDescription } = input;

    const builder = new SelectorPromptBuilder()
      .withStepContent(stepContent)
      .withComponentDescription(componentDescription);

    const messages = builder.build();
    const raw      = await llm.complete(messages, 0);

    let suggestions: SelectorSuggestion[] = [];
    try {
      suggestions = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      console.warn('⚠️   Could not parse selector suggestions as JSON — skipping Phase 3.');
    }

    return {
      phaseName:       this.name,
      content:         raw,
      messagesUsed:    messages.length,
      estimatedTokens: builder.estimatedTokens(),
      suggestions,
    };
  }
}
