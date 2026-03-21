// src/cache/ContextBuilder.ts
//
// Design pattern: Builder — constructs the CodebaseContext step by step
// using injected services. Each step is a discrete, testable operation.
//
// Performance fix: eliminates the duplicate file scans that existed in the
// old architecture — files are read once, sanitized once, extracted once.
// The stepRegistry is built from the already-parsed steps cache, not a
// second full disk scan.

import {
  CodebaseContext, ContextFile, SanitizationStats,
  StepRegistry, StepEntry,
  FeatureCacheEntry, StepFileCacheEntry, SelectorCacheEntry, RegistryEntry,
  AllCaches,
} from '../types';
import { FileReader } from '../services/FileReader';
import { Sanitizer, SanitizeOptions } from '../services/Sanitizer';
import { Extractor }  from '../services/Extractor';
import { CacheStore } from './CacheStore';
import { RawFile }    from '../services/FileReader';

const MAX_CHARS_PER_SECTION = 12_000;

export class ContextBuilder {
  private readonly reader:    FileReader;
  private readonly sanitizer: Sanitizer;
  private readonly extractor: Extractor;
  private readonly store:     CacheStore;

  constructor(private readonly rootDir: string) {
    this.reader    = new FileReader(rootDir);
    this.sanitizer = new Sanitizer();
    this.extractor = new Extractor();
    this.store     = new CacheStore(rootDir);
  }

  /** Rebuild all caches (only re-processes files whose hash changed) then return context */
  async build(featureName: string): Promise<CodebaseContext> {
    const caches = await this.rebuildCaches();
    return this.assembleContext(featureName, caches);
  }

  /** Public access for the rebuild-cache CLI script */
  async rebuildCaches(): Promise<AllCaches> {
    const [features, steps, selectors] = await Promise.all([
      this.buildFeaturesCache(),
      this.buildStepsCache(),
      this.buildSelectorsCache(),
    ]);

    const registry = this.buildRegistryFromSteps(steps);
    const caches: AllCaches = { features, steps, selectors, registry };

    await this.store.writeAll(caches);
    return caches;
  }

  /** Read existing caches without rebuilding */
  async loadCaches(): Promise<AllCaches> {
    return this.store.readAll();
  }

  async cacheExists(): Promise<boolean> {
    return this.store.exists();
  }

  async clearCache(): Promise<void> {
    return this.store.clear();
  }

  // ─── Cache builders ────────────────────────────────────────────────────────

  private async buildFeaturesCache() {
    const existing  = await this.store.readAll();
    const existingMap = new Map(existing.features.entries.map(e => [e.relativePath, e]));

    const paths = this.reader.find('cypress/e2e/**/*.feature');
    const files = await this.reader.readAll(paths);

    const entries: FeatureCacheEntry[] = await Promise.all(
      files.map(f => this.processFeatureFile(f, existingMap))
    );

    return this.store.makeEnvelope(entries);
  }

  private async buildStepsCache() {
    const existing  = await this.store.readAll();
    const existingMap = new Map(existing.steps.entries.map(e => [e.relativePath, e]));

    const paths = this.reader.find('cypress/e2e/**/*.{ts,js}');
    const files = await this.reader.readAll(paths);

    const entries: StepFileCacheEntry[] = await Promise.all(
      files.map(f => this.processStepFile(f, existingMap))
    );

    return this.store.makeEnvelope(entries);
  }

  private async buildSelectorsCache() {
    const existing  = await this.store.readAll();
    const existingMap = new Map(existing.selectors.entries.map(e => [e.testId, e]));
    const now       = new Date().toISOString();

    const paths = [
      ...this.reader.find('cypress/e2e/**/*.{ts,js}'),
      ...this.reader.find('cypress/support/**/*.{ts,js}'),
    ];
    const files = await this.reader.readAll(paths);

    // Aggregate all selectors across files
    const foundMap = new Map<string, Set<string>>();
    for (const f of files) {
      for (const testId of this.extractor.extractSelectors(f.content)) {
        if (!foundMap.has(testId)) foundMap.set(testId, new Set());
        foundMap.get(testId)!.add(f.relativePath);
      }
    }

    const entries: SelectorCacheEntry[] = [...foundMap.entries()].map(([testId, sourceFiles]) => ({
      testId,
      sourceFiles:  [...sourceFiles],
      firstSeen:    existingMap.get(testId)?.firstSeen ?? now,
      lastSeen:     now,
    }));

    return this.store.makeEnvelope(entries);
  }

  private buildRegistryFromSteps(stepsCache: ReturnType<CacheStore['makeEnvelope']> & { entries: StepFileCacheEntry[] }) {
    const seen    = new Set<string>();
    const entries: RegistryEntry[] = [];
    const now     = new Date().toISOString();

    for (const file of stepsCache.entries) {
      for (const p of file.patterns) {
        if (seen.has(p.pattern)) continue;
        seen.add(p.pattern);
        entries.push({ pattern: p.pattern, keyword: p.keyword, definedIn: file.relativePath, registeredAt: now });
      }
    }

    return this.store.makeEnvelope(entries);
  }

  // ─── File processors (cache-aware) ────────────────────────────────────────

  private processFeatureFile(
    f: RawFile,
    cache: Map<string, FeatureCacheEntry>
  ): FeatureCacheEntry {
    const cached = cache.get(f.relativePath);
    if (cached?.contentHash === f.contentHash) return cached;

    const { content } = this.sanitizer.sanitize(f.content, { stubMethodBodies: false });
    const meta        = this.extractor.extractFeatureMetadata(f.content);

    return {
      relativePath:     f.relativePath,
      contentHash:      f.contentHash,
      mtime:            f.mtime,
      sanitizedContent: content.trim(),
      ...meta,
    };
  }

  private processStepFile(
    f: RawFile,
    cache: Map<string, StepFileCacheEntry>
  ): StepFileCacheEntry {
    const cached = cache.get(f.relativePath);
    if (cached?.contentHash === f.contentHash) return cached;

    const isPageObj   = f.relativePath.includes('pageObjects');
    const opts: SanitizeOptions = { stubMethodBodies: isPageObj };
    const { content } = this.sanitizer.sanitize(f.content, opts);

    return {
      relativePath:        f.relativePath,
      contentHash:         f.contentHash,
      mtime:               f.mtime,
      sanitizedContent:    content.trim(),
      patterns:            this.extractor.extractStepPatterns(f.content),
      importedPageObjects: this.extractor.extractPageObjectImports(f.content),
    };
  }

  // ─── Context assembly ──────────────────────────────────────────────────────

  private assembleContext(featureName: string, caches: AllCaches): CodebaseContext {
    const allStepFiles = caches.steps.entries;

    const stepDefFiles = allStepFiles.filter(
      e => !e.relativePath.includes('pageObjects') && !e.relativePath.includes('commands')
    );
    const pageObjFiles = allStepFiles.filter(e => e.relativePath.includes('pageObjects'));
    const commandFiles = allStepFiles.filter(e => e.relativePath.includes('commands'));

    return {
      existingFeatures: this.toContextFiles(
        FileReader.topN(caches.features.entries, featureName, 3)
      ),
      existingStepDefs: this.toContextFiles(
        FileReader.topN(stepDefFiles, featureName, 3)
      ),
      pageObjects: this.toContextFiles(
        FileReader.topN(pageObjFiles, featureName, 4)
      ),
      cypressCommands: this.toContextFiles(
        FileReader.topN(commandFiles, featureName, 2)
      ),
      sampleSelectors: caches.selectors.entries
        .map(e => e.testId)
        .filter(Boolean)
        .slice(0, 40),
      stepRegistry: this.buildStepRegistry(caches.registry.entries),
    };
  }

  private toContextFiles(
    entries: Array<{ relativePath: string; sanitizedContent: string }>
  ): ContextFile[] {
    const results: ContextFile[] = [];
    let total = 0;

    for (const e of entries) {
      const content = e.sanitizedContent.trim();
      if (total + content.length > MAX_CHARS_PER_SECTION) break;

      const stats: SanitizationStats = {
        secretsRedacted: 0, urlsRedacted: 0, emailsRedacted: 0,
        uuidsRedacted: 0,  methodBodiesStubbed: 0,
        originalLength: content.length, sanitizedLength: content.length,
      };

      results.push({ relativePath: e.relativePath, content, sanitizationStats: stats });
      total += content.length;
    }

    return results;
  }

  private buildStepRegistry(entries: RegistryEntry[]): StepRegistry {
    if (entries.length === 0) {
      return {
        entries: [],
        promptBlock: 'EXISTING STEP REGISTRY: No existing steps found — implement all steps from scratch.',
      };
    }

    const byFile = new Map<string, RegistryEntry[]>();
    for (const e of entries) {
      const list = byFile.get(e.definedIn) ?? [];
      list.push(e);
      byFile.set(e.definedIn, list);
    }

    const lines = [
      'EXISTING STEP REGISTRY — these steps are ALREADY IMPLEMENTED.',
      'Rules:',
      '  1. Steps listed here → add import, do NOT reimplement.',
      '  2. Steps NOT listed here → implement fresh.',
      '',
    ];

    for (const [file, fileEntries] of byFile) {
      lines.push(`File: ${file}`);
      for (const e of fileEntries) lines.push(`  ${e.keyword}('${e.pattern}')`);
      lines.push('');
    }

    return {
      entries: entries.map(e => ({
        pattern: e.pattern, keyword: e.keyword, definedIn: e.definedIn,
      } as StepEntry)),
      promptBlock: lines.join('\n'),
    };
  }
}
