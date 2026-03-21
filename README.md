# E2E Test Agent v5

Generates Cypress + Cucumber e2e tests from a plain-text feature description
using your GitHub Copilot subscription.

## What's new in v5

- **Security**: per-file sanitization (no cross-file boundary leakage), prompt
  injection validation on all task inputs, token never printed in error messages
- **Performance**: parallel file I/O via `Promise.all`, parallel cache writes,
  single disk scan (no duplicate reads), single-pass sanitization pipeline
- **Architecture**: Strategy pattern for phases, Builder pattern for prompts,
  Repository pattern for cache, single `types/index.ts` source of truth

## Setup

```bash
cd e2e-agent
npm install
cp .env.example .env
# set GITHUB_TOKEN=ghp_your_token
```

## Usage

```bash
# From a task file (recommended)
npm run generate:file tasks/EditUserProfile.json

# Interactive
npm run generate:interactive

# Cache management
npm run cache:rebuild     # force rebuild all JSON caches
npm run cache:inspect     # print what the agent knows about your codebase
npm run cache:clear       # delete .cache/ directory
```

## Task JSON schema

```json
{
  "featureName": "EditUserProfile",
  "description": "One sentence description",
  "testSteps": "1. Step one\n2. Step two",
  "componentDescription": "Optional — new UI component for selector advice",
  "rootDir": "../my-app",
  "outputDir": "../my-app/cypress/e2e/generated/EditUserProfile"
}
```

## Project structure

```
src/
  types/index.ts          ← all domain types (single source of truth)
  services/
    Sanitizer.ts          ← single-pass sanitization pipeline + input validation
    FileReader.ts         ← parallel async file I/O
    Extractor.ts          ← step patterns, selectors, feature metadata
    LLMClient.ts          ← Copilot API with retry + backoff
  cache/
    CacheStore.ts         ← JSON persistence (parallel reads/writes)
    ContextBuilder.ts     ← assembles CodebaseContext from caches
  prompts/
    PromptBuilder.ts      ← fluent base class
    FeaturePromptBuilder.ts
    StepPromptBuilder.ts
    SelectorPromptBuilder.ts
  pipeline/
    Phase.ts              ← FeaturePhase, StepPhase, SelectorPhase (Strategy)
    AuditLogger.ts        ← local audit trail
  Agent.ts                ← thin orchestrator
scripts/
  run-agent.ts
  rebuild-cache.ts
```

## Security model

Your codebase never leaves your machine unsanitized. Each file is processed
independently through a sanitization pipeline that strips secrets, internal
URLs, real emails, UUIDs, and page object method bodies before any API call.
All task JSON inputs are validated and injection-cleaned before entering prompts.
An audit log records what was sent — inspect with `npm run cache:inspect`.
