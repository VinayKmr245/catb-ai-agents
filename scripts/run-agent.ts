#!/usr/bin/env ts-node
// scripts/run-agent.ts

import * as path   from 'path';
import * as fs     from 'fs';
import * as rl     from 'readline';
import * as dotenv from 'dotenv';
import { Agent }      from '../src/Agent';
import { AgentInput } from '../src/types';

dotenv.config();

const args = process.argv.slice(2);

async function main() {
  let input: AgentInput;

  if (args[0] === '--config' && args[1]) {
    const p = path.resolve(args[1]);
    if (!fs.existsSync(p)) { console.error(`\n❌  Not found: ${p}\n`); process.exit(1); }
    input = resolveInput(JSON.parse(fs.readFileSync(p, 'utf8')));
    console.log(`📋  Task: ${p}`);

  } else if (process.env.FEATURE_NAME) {
    input = resolveInput({
      featureName:          process.env.FEATURE_NAME,
      description:          process.env.DESCRIPTION ?? '',
      testSteps:            (process.env.TEST_STEPS ?? '').replace(/\\n/g, '\n'),
      componentDescription: process.env.COMPONENT_DESCRIPTION,
    });

  } else if (args[0] === '--interactive' || args.length === 0) {
    input = await promptInteractive();

  } else {
    console.log('Usage: npm run generate:file tasks/MyFeature.json');
    process.exit(1);
  }

  await new Agent().run(input);
}

function resolveInput(raw: Partial<AgentInput>): AgentInput {
  if (!raw.featureName) throw new Error('featureName is required');
  if (!raw.description)  throw new Error('description is required');
  if (!raw.testSteps)    throw new Error('testSteps is required');

  const rootDir = raw.rootDir
    ? path.resolve(raw.rootDir)
    : path.resolve(process.env.CYPRESS_ROOT ?? process.cwd());

  const outputDir = raw.outputDir
    ? path.resolve(raw.outputDir)
    : path.join(rootDir, process.env.OUTPUT_DIR ?? 'cypress/e2e/generated', raw.featureName);

  return { ...raw as AgentInput, rootDir, outputDir };
}

async function promptInteractive(): Promise<AgentInput> {
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  const ask   = (q: string) => new Promise<string>(r => iface.question(q, a => r(a.trim())));

  console.log('\n🤖  E2E Test Agent — Interactive\n');
  const featureName = await ask('Feature name (PascalCase): ');
  const description = await ask('One-sentence description: ');

  console.log('\nPaste test steps — type END to finish:\n');
  const steps: string[] = [];
  while (true) {
    const line = await ask('');
    if (line.toUpperCase() === 'END') break;
    steps.push(line);
  }

  const componentDescription = await ask('\nNew component description (blank to skip): ');
  const rootDir = await ask(`Cypress root [${process.env.CYPRESS_ROOT ?? process.cwd()}]: `)
    || (process.env.CYPRESS_ROOT ?? process.cwd());

  iface.close();
  return resolveInput({ featureName, description, testSteps: steps.join('\n'), componentDescription: componentDescription || undefined, rootDir });
}

main().catch(err => { console.error('\n❌ ', err.message ?? err); process.exit(1); });
