// src/pipeline/AuditLogger.ts
//
// Records sanitization stats and LLM message previews locally.
// Audit logs never leave the machine — written to .audit-logs/ only.

import * as fs   from 'fs';
import * as path from 'path';
import {
  AuditRecord, PhaseAuditEntry, SanitizationSummaryEntry,
  CodebaseContext, ChatMessage, CopilotConfig,
} from '../types';

export class AuditLogger {
  private readonly enabled: boolean;
  private readonly logDir:  string;
  private record: Partial<AuditRecord> = {};

  constructor() {
    this.enabled = process.env.AUDIT_LOG === 'true';
    this.logDir  = path.resolve(process.env.AUDIT_LOG_DIR ?? '.audit-logs');
  }

  start(featureName: string, config: CopilotConfig): void {
    if (!this.enabled) return;
    this.record = {
      timestamp:           new Date().toISOString(),
      featureName,
      model:               config.model,
      apiEndpoint:         config.baseURL,
      sanitizationSummary: [],
      phases:              [],
    };
  }

  recordContext(context: CodebaseContext): void {
    if (!this.enabled) return;

    const summarize = (files: CodebaseContext['existingFeatures'], type: string): SanitizationSummaryEntry[] =>
      files.map(f => ({
        file:               f.relativePath,
        type,
        originalLength:     f.sanitizationStats.originalLength,
        sanitizedLength:    f.sanitizationStats.sanitizedLength,
        totalRedactions:    f.sanitizationStats.secretsRedacted +
                            f.sanitizationStats.urlsRedacted +
                            f.sanitizationStats.emailsRedacted +
                            f.sanitizationStats.uuidsRedacted,
        methodBodiesStubbed: f.sanitizationStats.methodBodiesStubbed,
      }));

    this.record.sanitizationSummary = [
      ...summarize(context.existingFeatures,  'feature'),
      ...summarize(context.existingStepDefs,  'stepDef'),
      ...summarize(context.pageObjects,        'pageObject'),
      ...summarize(context.cypressCommands,    'command'),
    ];
  }

  recordPhase(phaseName: string, messages: ChatMessage[]): void {
    if (!this.enabled) return;

    const entry: PhaseAuditEntry = {
      phase:         phaseName,
      messageCount:  messages.length,
      estimatedTokens: Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4),
      messagePreviews: messages.map(m => ({
        role:    m.role,
        preview: m.content.slice(0, 200) + (m.content.length > 200 ? '…' : ''),
        length:  m.content.length,
      })),
    };

    this.record.phases = [...(this.record.phases ?? []), entry];
  }

  write(): string | undefined {
    if (!this.enabled || !this.record.featureName) return undefined;

    fs.mkdirSync(this.logDir, { recursive: true });
    const filename = `${this.record.featureName}-${Date.now()}.audit.json`;
    const logPath  = path.join(this.logDir, filename);

    fs.writeFileSync(logPath, JSON.stringify(this.record, null, 2) + '\n');
    this.printSummary(logPath);
    return logPath;
  }

  private printSummary(logPath: string): void {
    const summary = this.record.sanitizationSummary ?? [];
    const total   = summary.reduce((s, f) => s + f.totalRedactions, 0);
    const stubs   = summary.reduce((s, f) => s + f.methodBodiesStubbed, 0);

    console.log('\n   Sanitization audit:');
    console.log(`   Files       : ${summary.length}`);
    console.log(`   Redactions  : ${total}`);
    console.log(`   Method stubs: ${stubs}`);
    console.log(`   Audit log   : ${logPath}\n`);
  }
}
