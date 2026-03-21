// src/services/Extractor.ts
//
// Design pattern: Service — pure transformation, no I/O.
// Extracts structured data (step patterns, selectors, feature metadata)
// from raw source strings.
//
// Performance fix: replaces the duplicate full-file scan in stepRegistry.ts
// — extraction now happens exactly once, during the cache rebuild.

import { StepPatternEntry } from '../types';

const STEP_ANNOTATION_RE =
  /\b(Given|When|Then)\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g;

const TESTID_RE =
  /data-testid[=:\s'"]+['"`]([^'"`]+)['"`]/g;

const FEATURE_NAME_RE  = /^Feature:\s*(.+)$/m;
const FEATURE_TAG_RE   = /^@(\w+)/gm;
const SCENARIO_RE      = /^\s*Scenario(?:\s+Outline)?:/gm;
const PAGE_IMPORT_RE   = /import\s+\{[^}]+\}\s+from\s+['"`][^'"`]*pageObjects[^'"`]*['"`]/g;

export class Extractor {

  /** Extract all Given/When/Then step patterns from a step definition file */
  extractStepPatterns(source: string): StepPatternEntry[] {
    const results: StepPatternEntry[] = [];
    const seen = new Set<string>();

    for (const match of source.matchAll(STEP_ANNOTATION_RE)) {
      const keyword = match[1] as 'Given' | 'When' | 'Then';
      const pattern = (match[2] ?? match[3] ?? match[4] ?? '').trim();
      if (!pattern || seen.has(pattern)) continue;
      seen.add(pattern);
      results.push({ pattern, keyword });
    }

    return results;
  }

  /** Extract all unique data-testid values from source code */
  extractSelectors(source: string): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    for (const match of source.matchAll(TESTID_RE)) {
      const testId = match[1]?.trim();
      if (!testId || seen.has(testId)) continue;
      seen.add(testId);
      results.push(testId);
    }

    return results;
  }

  /** Extract feature metadata from a .feature file */
  extractFeatureMetadata(source: string): {
    featureName: string;
    tags: string[];
    scenarioCount: number;
  } {
    const nameMatch    = source.match(FEATURE_NAME_RE);
    const tags         = [...source.matchAll(FEATURE_TAG_RE)].map(m => m[1]);
    const scenarioCount = [...source.matchAll(SCENARIO_RE)].length;

    return {
      featureName:   nameMatch ? nameMatch[1].trim() : 'Unknown',
      tags:          [...new Set(tags)],
      scenarioCount,
    };
  }

  /** Extract page object import statements from a step def file */
  extractPageObjectImports(source: string): string[] {
    return [...source.matchAll(PAGE_IMPORT_RE)].map(m => m[0]);
  }
}
