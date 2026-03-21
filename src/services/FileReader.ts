// src/services/FileReader.ts
//
// Performance fix: replaces sequential fs.readFileSync loops with
// Promise.all parallel async reads.
//
// Design pattern: Service — pure I/O, no business logic.

import * as fs   from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob }  from 'glob';

export interface RawFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  contentHash: string;
  mtime: number;
}

export class FileReader {
  constructor(private readonly rootDir: string) {}

  /** Find files matching a glob pattern relative to rootDir */
  find(pattern: string): string[] {
    return glob.sync(pattern, { cwd: this.rootDir, absolute: true });
  }

  /** Read multiple files in parallel. Files that fail to read are silently skipped. */
  async readAll(absolutePaths: string[]): Promise<RawFile[]> {
    const results = await Promise.all(
      absolutePaths.map(p => this.readOne(p))
    );
    return results.filter((r): r is RawFile => r !== null);
  }

  /** Read a single file — returns null on error instead of throwing */
  async readOne(absolutePath: string): Promise<RawFile | null> {
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(absolutePath, 'utf8'),
        fs.stat(absolutePath),
      ]);

      return {
        absolutePath,
        relativePath: path.relative(this.rootDir, absolutePath),
        content,
        contentHash:  sha256(content),
        mtime:        stat.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  /** Score a file path by how many PascalCase words from featureName it contains */
  static scoreRelevance(filePath: string, featureName: string): number {
    const words = featureName
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 2);

    const base = path.basename(filePath).toLowerCase();
    return words.filter(w => base.includes(w)).length;
  }

  /** Sort files by relevance score descending and return top n */
  static topN<T extends { relativePath: string }>(
    items: T[],
    featureName: string,
    n: number
  ): T[] {
    return [...items]
      .map(item => ({ item, score: FileReader.scoreRelevance(item.relativePath, featureName) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(x => x.item);
  }
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
