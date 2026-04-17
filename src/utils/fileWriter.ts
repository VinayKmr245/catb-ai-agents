// src/utils/fileWriter.ts
// Writes generated files to disk, handling both new files and patches to existing ones

import * as fs from "fs";
import * as path from "path";
import type { GeneratedOutput, ProjectConfig } from "../types";

interface WriteResult {
  created: string[];
  modified: string[];
}

export class FileWriter {
  constructor(private config: ProjectConfig) {}

  async writeAll(output: GeneratedOutput): Promise<WriteResult> {
    const result: WriteResult = { created: [], modified: [] };

    // Write feature file
    const featurePath = path.join(
      this.config.featuresDir,
      output.featureFile.filename
    );
    this.ensureDir(path.dirname(featurePath));
    const featureExists = fs.existsSync(featurePath);
    fs.writeFileSync(featurePath, output.featureFile.content, "utf-8");
    if (featureExists) {
      result.modified.push(featurePath);
    } else {
      result.created.push(featurePath);
    }

    // Write new step definition files
    for (const stepFile of output.newSteps) {
      if (!stepFile.content) continue;
      const stepPath = path.join(this.config.stepsDir, stepFile.filename);
      this.ensureDir(path.dirname(stepPath));
      const exists = fs.existsSync(stepPath);
      fs.writeFileSync(stepPath, stepFile.content, "utf-8");
      exists ? result.modified.push(stepPath) : result.created.push(stepPath);
    }

    // Write / patch selector files
    for (const selectorAddition of output.newSelectors) {
      const selPath = path.join(this.config.selectorsDir, selectorAddition.targetFile);
      this.ensureDir(path.dirname(selPath));

      if (fs.existsSync(selPath)) {
        // Patch existing file — add new entries before the closing brace
        const existing = fs.readFileSync(selPath, "utf-8");
        const newEntries = Object.entries(selectorAddition.additions)
          .map(([k, v]) => `  ${k}: '${v}',`)
          .join("\n");
        const patched = existing.replace(/(\n\s*\};\s*$)/, `\n${newEntries}$1`);
        fs.writeFileSync(selPath, patched, "utf-8");
        result.modified.push(selPath);
      } else {
        // Create new selector file
        fs.writeFileSync(selPath, selectorAddition.patchContent, "utf-8");
        result.created.push(selPath);
      }
    }

    return result;
  }

  /** Write files to an output directory for preview/dry-run */
  async writePreview(output: GeneratedOutput, outputDir: string): Promise<WriteResult> {
    const result: WriteResult = { created: [], modified: [] };

    this.ensureDir(outputDir);

    const featurePath = path.join(outputDir, "features", output.featureFile.filename);
    this.ensureDir(path.dirname(featurePath));
    fs.writeFileSync(featurePath, output.featureFile.content, "utf-8");
    result.created.push(featurePath);

    for (const stepFile of output.newSteps) {
      if (!stepFile.content) continue;
      const p = path.join(outputDir, "steps", stepFile.filename);
      this.ensureDir(path.dirname(p));
      fs.writeFileSync(p, stepFile.content, "utf-8");
      result.created.push(p);
    }

    for (const sel of output.newSelectors) {
      if (!sel.patchContent) continue;
      const p = path.join(outputDir, "selectors", sel.targetFile);
      this.ensureDir(path.dirname(p));
      fs.writeFileSync(p, sel.patchContent, "utf-8");
      result.created.push(p);
    }

    return result;
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
