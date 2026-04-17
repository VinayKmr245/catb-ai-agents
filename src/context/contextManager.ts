// src/context/contextManager.ts
// Manages context window efficiently for large projects with 1000+ features.
// Uses semantic similarity grouping to pass only RELEVANT existing steps/selectors
// to the AI — prevents context overload at scale.

import * as path from "path";
import type { ExistingContext, TestRequirement } from "../types";

/**
 * For large projects, passing ALL 1000+ feature files to the AI is wasteful and
 * may exceed context limits. This manager selects the most relevant subset.
 */
export class ContextManager {
  /**
   * Filters existing context to the most relevant files for the given requirements.
   * Uses keyword overlap scoring — fast and effective without embeddings.
   */
  filterRelevantContext(
    context: ExistingContext,
    requirements: TestRequirement,
    maxStepFiles = 10,
    maxSelectorFiles = 8,
    maxFeatureFiles = 5
  ): ExistingContext {
    const keywords = this.extractKeywords(requirements);

    // Score and rank step definition files
    const scoredSteps = context.stepDefinitions
      .map((file) => ({
        file,
        score: this.scoreRelevance(
          file.steps.map((s) => s.pattern).join(" "),
          keywords
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxStepFiles)
      .map((s) => s.file);

    // Score and rank selector files
    const scoredSelectors = context.selectors
      .map((file) => ({
        file,
        score: this.scoreRelevance(
          `${file.name} ${Object.keys(file.selectors).join(" ")}`,
          keywords
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSelectorFiles)
      .map((s) => s.file);

    // Score and rank feature files (for scenario name deduplication)
    const scoredFeatures = context.features
      .map((file) => ({
        file,
        score: this.scoreRelevance(
          `${file.name} ${file.scenarios.join(" ")}`,
          keywords
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFeatureFiles)
      .map((s) => s.file);

    return {
      stepDefinitions: scoredSteps,
      selectors: scoredSelectors,
      features: scoredFeatures,
    };
  }

  /**
   * Builds a tiered context summary:
   * - Tier 1 (always included): All step patterns — compact list
   * - Tier 2 (relevant only): Full selector file contents
   * - Tier 3 (optional): Scenario names for deduplication
   */
  buildTieredSummary(
    fullContext: ExistingContext,
    filteredContext: ExistingContext
  ): string {
    const parts: string[] = [];

    // Tier 1: ALL step patterns (compact — just the pattern strings)
    const allSteps = fullContext.stepDefinitions.flatMap((f) =>
      f.steps.map((s) => `${s.keyword}("${s.pattern}")  [${path.basename(f.path)}]`)
    );
    if (allSteps.length > 0) {
      parts.push("=== ALL EXISTING STEP PATTERNS (DO NOT DUPLICATE) ===");
      parts.push(allSteps.join("\n"));
    }

    // Tier 2: Relevant selector files (full content)
    if (filteredContext.selectors.length > 0) {
      parts.push("\n=== RELEVANT SELECTOR FILES ===");
      for (const sel of filteredContext.selectors) {
        parts.push(`\n// ${sel.name} — export: ${sel.exportName}`);
        parts.push(`export const ${sel.exportName} = {`);
        for (const [k, v] of Object.entries(sel.selectors)) {
          parts.push(`  ${k}: '${v}',`);
        }
        parts.push("};");
      }
    }

    // Tier 3: Existing scenario names (for deduplication awareness)
    if (filteredContext.features.length > 0) {
      parts.push("\n=== RELATED EXISTING SCENARIOS (avoid duplicating) ===");
      for (const feat of filteredContext.features) {
        parts.push(`${feat.name}: ${feat.scenarios.join(" | ")}`);
      }
    }

    return parts.join("\n");
  }

  private extractKeywords(requirements: TestRequirement): string[] {
    const text = [
      requirements.title,
      requirements.description,
      ...requirements.tags,
      ...requirements.acceptanceCriteria,
    ]
      .join(" ")
      .toLowerCase();

    // Extract meaningful words — skip stop words
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "that", "this", "these", "those", "it", "its",
      "user", "should", "can", "able",
    ]);

    return text
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 30); // Top 30 keywords
  }

  private scoreRelevance(text: string, keywords: string[]): number {
    const lowerText = text.toLowerCase();
    return keywords.reduce((score, kw) => {
      return score + (lowerText.includes(kw) ? 1 : 0);
    }, 0);
  }

  /**
   * Groups a large list of requirements into feature domains
   * Useful for batch processing — groups similar tickets together
   * so their context builds on each other
   */
  groupByDomain(requirements: TestRequirement[]): Map<string, TestRequirement[]> {
    const groups = new Map<string, TestRequirement[]>();

    for (const req of requirements) {
      // Use the first tag as domain, or derive from title
      const domain =
        req.tags[0] ||
        req.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .split("-")[0];

      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain)!.push(req);
    }

    return groups;
  }
}
