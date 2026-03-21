#!/usr/bin/env ts-node
// scripts/rebuild-cache.ts

import * as path   from 'path';
import * as dotenv from 'dotenv';
import { ContextBuilder } from '../src/cache/ContextBuilder';

dotenv.config();

const args    = process.argv.slice(2);
const command = args[0] ?? 'rebuild';
const rootDir = (() => {
  const i = args.indexOf('--root');
  return i !== -1 && args[i + 1]
    ? path.resolve(args[i + 1])
    : path.resolve(process.env.CYPRESS_ROOT ?? process.cwd());
})();

async function main() {
  const builder = new ContextBuilder(rootDir);

  if (command === 'clear') {
    await builder.clearCache();
    console.log('\n🗑️   Cache cleared.\n');
    return;
  }

  if (command === 'inspect') {
    if (!(await builder.cacheExists())) {
      console.log('\n⚠️   No cache found. Run: npm run cache:rebuild\n');
      return;
    }
    const caches = await builder.loadCaches();
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  features  : ${caches.features.entries.length} file(s)`);
    console.log(`  steps     : ${caches.steps.entries.length} file(s)`);
    console.log(`  selectors : ${caches.selectors.entries.length} unique`);
    console.log(`  registry  : ${caches.registry.entries.length} step(s)`);
    caches.registry.entries.forEach(e => console.log(`    ${e.keyword}('${e.pattern}') — ${e.definedIn}`));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }

  // default: rebuild
  console.log(`\nRebuilding caches for: ${rootDir}\n`);
  const caches = await builder.rebuildCaches();
  console.log(`✅  features.cache.json  → ${caches.features.entries.length} file(s)`);
  console.log(`✅  steps.cache.json     → ${caches.steps.entries.length} file(s)`);
  console.log(`✅  selectors.cache.json → ${caches.selectors.entries.length} selector(s)`);
  console.log(`✅  registry.cache.json  → ${caches.registry.entries.length} step pattern(s)\n`);
}

main().catch(err => { console.error('\n❌ ', err.message ?? err); process.exit(1); });
