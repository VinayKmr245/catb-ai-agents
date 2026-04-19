// src/tools/contextScanner.ts
// Scans the existing Cypress project to build context for the AI agents

import * as fs from "fs";
import { glob } from "glob";
import * as path from "path";
import type {
  ExistingContext,
  FeatureFile,
  ParsedStep,
  ProjectConfig,
  SelectorFile,
  StepDefinition,
} from "../types";

export class ContextScanner {
  constructor(private config: ProjectConfig) {}

  async scanAll(): Promise<ExistingContext> {
    const [features, stepDefinitions, selectors] = await Promise.all([
      this.scanFeatures(),
      this.scanStepDefinitions(),
      this.scanSelectors(),
    ]);

    return { features, stepDefinitions, selectors };
  }

  private async scanFeatures(): Promise<FeatureFile[]> {
    const dir = this.config.featuresDir;
    if (!fs.existsSync(dir)) return [];

    const files = await glob("**/*.feature", { cwd: dir, absolute: true });
    return files.map((filePath) => {
      const content = fs.readFileSync(filePath, "utf-8");
      return {
        path: filePath,
        name: path.basename(filePath),
        content,
        scenarios: this.extractScenarioNames(content),
      };
    });
  }

  private async scanStepDefinitions(): Promise<StepDefinition[]> {
    const dir = this.config.stepsDir;
    if (!fs.existsSync(dir)) return [];

    const files = await glob("**/*.{ts,js}", { cwd: dir, absolute: true });
    return files.map((filePath) => {
      const content = fs.readFileSync(filePath, "utf-8");
      return {
        path: filePath,
        content,
        steps: this.parseSteps(content),
      };
    });
  }

  private async scanSelectors(): Promise<SelectorFile[]> {
    const dir = this.config.selectorsDir;
    if (!fs.existsSync(dir)) return [];

    const files = await glob("**/*.{ts,js}", { cwd: dir, absolute: true });
    return files.map((filePath) => {
      const content = fs.readFileSync(filePath, "utf-8");
      const exportName = this.extractExportName(content);
      return {
        path: filePath,
        name: path.basename(filePath),
        content,
        exportName,
        selectors: this.parseSelectors(content),
      };
    });
  }

  private extractScenarioNames(content: string): string[] {
    const matches = content.matchAll(/^\s*Scenario(?:\s+Outline)?:\s*(.+)$/gm);
    return Array.from(matches).map((m) => m[1].trim());
  }

  parseSteps(content: string): ParsedStep[] {
    const steps: ParsedStep[] = [];

    // Match Given/When/Then/And/But with string or regex patterns
    const stepRegex =
      /(Given|When|Then|And|But)\(\s*(?:"([^"]+)"|'([^']+)'|\/([^/]+)\/)\s*,/g;
    let match;

    while ((match = stepRegex.exec(content)) !== null) {
      const keyword = match[1] as ParsedStep["keyword"];
      const pattern = match[2] || match[3] || match[4];
      const hasParams = pattern.includes("{") || pattern.includes("(");

      // Extract function body (simplified — captures between the arrow function braces)
      const afterMatch = content.slice(match.index);
      const bodyMatch = afterMatch.match(/=>\s*\{([\s\S]*?)\n\s*\}/);
      const functionBody = bodyMatch ? bodyMatch[1].trim() : "";

      steps.push({
        keyword,
        pattern,
        regex: this.patternToRegex(pattern),
        hasParams,
        functionBody,
      });
    }

    return steps;
  }

  private patternToRegex(pattern: string): string {
    return pattern
      .replace(/\{string\}/g, '"([^"]*)"')
      .replace(/\{int\}/g, "(\\d+)")
      .replace(/\{float\}/g, "([\\d.]+)")
      .replace(/\{word\}/g, "(\\w+)");
  }

  extractExportName(content: string): string {
    const match = content.match(/export\s+const\s+(\w+Selectors)\s*=/);
    return match ? match[1] : "unknownSelectors";
  }

  parseSelectors(content: string): Record<string, string> {
    const selectors: Record<string, string> = {};
    const objMatch = content.match(/export\s+const\s+\w+\s*=\s*\{([\s\S]*?)\}/);
    if (!objMatch) return selectors;

    const body = objMatch[1];
    const entryRegex = /(\w+)\s*:\s*['"`]([^'"`]+)['"`]/g;
    const result: Record<string, string> = {};
    let m;
    while ((m = entryRegex.exec(body)) !== null) {
      result[m[1]] = m[2];
    }
    return result;
  }

  /**
   * Builds a compact summary string for the AI to reason about
   * without blowing the context window on large projects
   */
  buildContextSummary(context: ExistingContext): string {
    const parts: string[] = [];

    if (context.stepDefinitions.length > 0) {
      parts.push("=== EXISTING STEP DEFINITIONS ===");
      for (const stepFile of context.stepDefinitions) {
        const fileName = path.basename(stepFile.path);
        parts.push(`\nFile: ${fileName}`);
        for (const step of stepFile.steps) {
          parts.push(`  ${step.keyword}("${step.pattern}")`);
        }
      }
    }

    if (context.selectors.length > 0) {
      parts.push("\n=== EXISTING SELECTORS ===");
      for (const selFile of context.selectors) {
        parts.push(`\nFile: ${selFile.name}  →  export: ${selFile.exportName}`);
        for (const [key, val] of Object.entries(selFile.selectors)) {
          parts.push(`  ${key}: '${val}'`);
        }
      }
    }

    if (context.features.length > 0) {
      parts.push("\n=== EXISTING FEATURES (scenario names only) ===");
      for (const feat of context.features) {
        parts.push(`\n${feat.name}:`);
        for (const s of feat.scenarios) {
          parts.push(`  - ${s}`);
        }
      }
    }

    if (parts.length === 0) {
      return "No existing Cypress files found. Starting from scratch.";
    }

    return parts.join("\n");
  }
}
