// src/cache/CacheStore.ts
//
// Design pattern: Repository — abstracts all JSON cache persistence.
// Consumers read/write typed domain objects; CacheStore handles serialization.
//
// Performance fix: all four cache files written in parallel via Promise.all.
// All file reads also parallelized.

import * as fs   from 'fs/promises';
import * as path from 'path';
import {
  AllCaches, CacheEnvelope, CACHE_SCHEMA_VERSION,
  FeaturesCache, StepsCache, SelectorsCache, RegistryCache,
  FeatureCacheEntry, StepFileCacheEntry, SelectorCacheEntry, RegistryEntry,
} from '../types';

export class CacheStore {
  private readonly cacheDir: string;

  private get featurePath()   { return path.join(this.cacheDir, 'features.cache.json');  }
  private get stepsPath()     { return path.join(this.cacheDir, 'steps.cache.json');     }
  private get selectorsPath() { return path.join(this.cacheDir, 'selectors.cache.json'); }
  private get registryPath()  { return path.join(this.cacheDir, 'registry.cache.json');  }

  constructor(private readonly projectRoot: string) {
    this.cacheDir = path.join(projectRoot, '.cache');
  }

  /** Write all four caches in parallel */
  async writeAll(caches: AllCaches): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await Promise.all([
      this.write(this.featurePath,   caches.features),
      this.write(this.stepsPath,     caches.steps),
      this.write(this.selectorsPath, caches.selectors),
      this.write(this.registryPath,  caches.registry),
    ]);
  }

  /** Read all four caches in parallel */
  async readAll(): Promise<AllCaches> {
    const [features, steps, selectors, registry] = await Promise.all([
      this.read<FeatureCacheEntry>(this.featurePath),
      this.read<StepFileCacheEntry>(this.stepsPath),
      this.read<SelectorCacheEntry>(this.selectorsPath),
      this.read<RegistryEntry>(this.registryPath),
    ]);
    return { features, steps, selectors, registry };
  }

  async exists(): Promise<boolean> {
    try {
      await Promise.all([
        fs.access(this.featurePath),
        fs.access(this.stepsPath),
        fs.access(this.selectorsPath),
        fs.access(this.registryPath),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.cacheDir, { recursive: true, force: true });
  }

  makeEnvelope<T>(entries: T[]): CacheEnvelope<T> {
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      builtAt:       new Date().toISOString(),
      projectRoot:   this.projectRoot,
      entries,
    };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async write<T>(filePath: string, data: CacheEnvelope<T>): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }

  private async read<T>(filePath: string): Promise<CacheEnvelope<T>> {
    const empty = this.makeEnvelope<T>([]);
    try {
      const raw    = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return empty;
      return parsed;
    } catch {
      return empty;
    }
  }
}
