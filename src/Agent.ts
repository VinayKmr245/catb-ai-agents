// src/Agent.ts
//
// Thin orchestrator — delegates to services, phases, and logger.
// Contains no business logic itself.

import * as fs   from 'fs';
import * as path from 'path';
import { AgentInput, AgentOutput } from './types';
import { LLMClient }       from './services/LLMClient';
import { Sanitizer }       from './services/Sanitizer';
import { ContextBuilder }  from './cache/ContextBuilder';
import { AuditLogger }     from './pipeline/AuditLogger';
import { FeaturePhase, StepPhase, SelectorPhase } from './pipeline/Phase';

export class Agent {
  private readonly sanitizer = new Sanitizer();

  async run(input: AgentInput): Promise<AgentOutput> {
    // ── 1. Validate and sanitize task inputs ──────────────────────────────
    const safeInput = this.validateInput(input);

    // ── 2. Build LLM client + verify access ───────────────────────────────
    const config = LLMClient.fromEnv();
    const llm    = new LLMClient(config);
    await llm.verify();

    // ── 3. Build codebase context from JSON cache ─────────────────────────
    log('📖', 'Building codebase context...');
    const builder = new ContextBuilder(safeInput.rootDir);
    const context = await builder.build(safeInput.featureName);

    log('🔒', `Context ready: ${context.existingStepDefs.length} step def(s), ` +
      `${context.pageObjects.length} page object(s), ` +
      `${context.sampleSelectors.length} selector(s), ` +
      `${context.stepRegistry.entries.length} registered step(s)`);

    // ── 4. Start audit ────────────────────────────────────────────────────
    const auditor = new AuditLogger();
    auditor.start(safeInput.featureName, config);
    auditor.recordContext(context);

    // ── 5. Phase 1 — Gherkin feature ──────────────────────────────────────
    log('✍️ ', 'Phase 1 — generating Gherkin feature...');
    const featureResult = await new FeaturePhase().run({ agentInput: safeInput, context }, llm);
    auditor.recordPhase(featureResult.phaseName, []);
    log('   ', `${featureResult.messagesUsed} messages, ~${featureResult.estimatedTokens} tokens`);

    // ── 6. Phase 2 — Step definitions ─────────────────────────────────────
    log('⚙️ ', 'Phase 2 — generating step definitions...');
    const stepResult = await new StepPhase().run({ context, featureContent: featureResult.content }, llm);
    auditor.recordPhase(stepResult.phaseName, []);
    log('   ', `${stepResult.messagesUsed} messages, ~${stepResult.estimatedTokens} tokens`);

    // ── 7. Phase 3 — Selector resolution (optional) ───────────────────────
    let selectorResult: Awaited<ReturnType<SelectorPhase['run']>> | undefined;

    if (safeInput.componentDescription) {
      log('🔍', 'Phase 3 — resolving selector placeholders...');
      selectorResult = await new SelectorPhase().run(
        { stepContent: stepResult.content, componentDescription: safeInput.componentDescription },
        llm
      );
      auditor.recordPhase(selectorResult.phaseName, []);
    }

    // ── 8. Write output files ─────────────────────────────────────────────
    fs.mkdirSync(safeInput.outputDir, { recursive: true });

    const featurePath  = path.join(safeInput.outputDir, `${safeInput.featureName}.feature`);
    const stepPath     = path.join(safeInput.outputDir, `${safeInput.featureName}.steps.ts`);
    const selectorPath = path.join(safeInput.outputDir, `${safeInput.featureName}.selectors.json`);

    fs.writeFileSync(featurePath, featureResult.content.trim() + '\n');
    fs.writeFileSync(stepPath,    stepResult.content.trim()    + '\n');

    if (selectorResult?.suggestions.length) {
      fs.writeFileSync(selectorPath, JSON.stringify(selectorResult.suggestions, null, 2) + '\n');
      selectorResult.suggestions.forEach(s => {
        log('   ', `• ${s.placeholder} → data-testid="${s.suggestedTestId}" (${s.elementHint})`);
      });
    }

    log('✅', `Feature   → ${featurePath}`);
    log('✅', `Step defs → ${stepPath}`);
    if (selectorResult?.suggestions.length) log('✅', `Selectors → ${selectorPath}`);

    // ── 9. Write audit log ────────────────────────────────────────────────
    const auditLogPath = auditor.write();

    return {
      featureFilePath:   featurePath,
      stepDefFilePath:   stepPath,
      selectorPatchPath: selectorResult?.suggestions.length ? selectorPath : undefined,
      auditLogPath,
      featureContent:    featureResult.content,
      stepDefContent:    stepResult.content,
      selectorPatch:     selectorResult?.suggestions,
    };
  }

  // ─── Input validation ─────────────────────────────────────────────────────

  private validateInput(input: AgentInput): AgentInput {
    const required: Array<keyof AgentInput> = ['featureName', 'description', 'testSteps', 'rootDir', 'outputDir'];
    for (const key of required) {
      if (!input[key]) throw new Error(`AgentInput.${key} is required`);
    }

    if (!/^[A-Z][A-Za-z0-9]+$/.test(input.featureName)) {
      throw new Error('featureName must be PascalCase alphanumeric, e.g. "EditUserProfile"');
    }

    return {
      ...input,
      description:          this.sanitizer.sanitizePromptInput(input.description,  'description'),
      testSteps:            this.sanitizer.sanitizePromptInput(input.testSteps,     'testSteps'),
      componentDescription: input.componentDescription
        ? this.sanitizer.sanitizePromptInput(input.componentDescription, 'componentDescription')
        : undefined,
    };
  }
}

function log(icon: string, msg: string): void {
  console.log(`${icon}  ${msg}`);
}
