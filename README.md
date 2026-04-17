# Cypress AI Test Generator

An AI-powered multi-agent system that automatically generates Cypress Cucumber E2E tests from Rally tickets or free-form text. Built for large applications with 1000+ features.

---

## Architecture

```
Input (Rally URL | Text)
        │
        ▼
┌───────────────────┐
│  Rally Agent      │  ← Fetches & structures Rally ticket data
│  Text Agent       │  ← Parses free-form requirements (fallback)
└────────┬──────────┘
         │ TestRequirement
         ▼
┌───────────────────┐
│  Context Scanner  │  ← Scans all existing .feature / steps / selectors
│  Context Manager  │  ← Filters to relevant subset (scale-safe)
└────────┬──────────┘
         │ ExistingContext (filtered)
         ▼
┌───────────────────┐
│  Feature Agent    │  ← Generates Gherkin feature file
└────────┬──────────┘
         │ newStepsNeeded[]
         ▼
┌───────────────────┐
│  Step Agent       │  ← Generates ONLY new step definitions
└────────┬──────────┘
         │ stepContent
         ▼
┌───────────────────┐
│  Selector Agent   │  ← Generates ONLY missing selectors
└────────┬──────────┘
         │ GeneratedOutput
         ▼
┌───────────────────┐
│  Reviewer Agent   │  ← Validates & auto-fixes issues
└────────┬──────────┘
         │
         ▼
    File Writer  →  .feature / Steps.ts / Selectors.ts
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
RALLY_API_KEY=your_rally_api_key
RALLY_BASE_URL=https://rally1.rallydev.com/slm/webservice/v2.0

FEATURES_DIR=./cypress/e2e/features
STEPS_DIR=./cypress/e2e/step_definitions
SELECTORS_DIR=./cypress/support/selectors
```

### 3. Point to your Cypress project

Update the `*_DIR` paths in `.env` to point at your actual Cypress project directories. The agent will scan these to build context.

---

## Usage

### Single ticket — Interactive mode

```bash
npm start
# Prompts you to choose Rally or text input
```

### Single ticket — Rally URL

```bash
npm start -- --rally-url US12345
npm start -- --rally-url "https://rally1.rallydev.com/#/detail/userstory/12345"
```

### Single ticket — Free-form text (fallback)

```bash
npm start -- --mode text --text "Users should be able to reset their password via email..."

# Or from a file:
npm start -- --mode text --text-file ./requirements/password-reset.txt
```

### Dry run (preview without writing files)

```bash
npm start -- --rally-url US12345 --dry-run --preview-dir ./output/preview
```

### Batch processing (1000+ features)

```bash
# From a list of Rally ticket IDs
npx ts-node src/batch.ts --rally-file ./examples/rally-tickets.txt

# From a JSON manifest (supports mixed Rally + text)
npx ts-node src/batch.ts --manifest ./examples/batch-manifest.json

# With options
npx ts-node src/batch.ts \
  --manifest ./examples/batch-manifest.json \
  --delay 3000 \
  --resume \
  --dry-run
```

### Testing without Rally credentials

```bash
npm start -- --mock-rally --rally-url US12345
```

---

## Generated Output

For each feature, the agent generates:

### 1. Feature File (`*.feature`)
```gherkin
@authentication @mfa
Feature: User Login with MFA
  As a registered user
  I want to log in with multi-factor authentication
  So that my account is more secure

  Background:
    Given the user is on the login page

  @smoke
  Scenario: Successful login with valid MFA code
    When the user enters valid credentials
    And the user is prompted for an MFA code
    And the user enters a valid MFA code
    Then the user should be redirected to the dashboard
```

### 2. Step Definitions (new steps only)
```typescript
// Only steps that don't already exist in your codebase
import { Given, When, Then } from "@badeball/cypress-cucumber-preprocessor";
import { mfaSelectors as sel } from "../../support/selectors/mfaSelectors";

When("the user is prompted for an MFA code", () => {
  cy.get(sel.mfaPrompt).should("be.visible");
});

When("the user enters a valid MFA code", () => {
  cy.get(sel.mfaInput).type("123456");
  cy.get(sel.mfaSubmitButton).click();
});
```

### 3. Selector Additions (new selectors only)
```typescript
// Added to mfaSelectors.ts or created fresh
export const mfaSelectors = {
  mfaPrompt: '[data-cy="mfa-prompt"]',
  mfaInput: '[data-cy="mfa-code-input"]',
  mfaSubmitButton: '[data-cy="mfa-submit-btn"]',
  mfaErrorMessage: '[data-cy="mfa-error-msg"]',
  resendCodeLink: '[data-cy="mfa-resend-link"]',
};
```

---

## Rules Enforced by Agents

| Rule | How enforced |
|------|-------------|
| No duplicate steps | Context Scanner indexes all existing patterns; Feature Agent and Reviewer validate against them |
| `data-cy` selectors only | Selector Agent system prompt + Reviewer Agent check |
| Reuse before create | Feature Agent explicitly marks `reusedSteps[]` and `newStepsNeeded[]` |
| Given/When/Then convention | Step Agent system prompt enforced |
| camelCase selector keys | Selector Agent system prompt + pattern examples |
| Independent scenarios | Feature Agent system prompt + Reviewer Agent |

---

## Project Structure

```
cypress-ai-agent/
├── src/
│   ├── index.ts              # Main CLI entry point
│   ├── batch.ts              # Batch processing CLI
│   ├── types.ts              # All TypeScript interfaces
│   ├── agents/
│   │   ├── orchestrator.ts   # Standard pipeline orchestrator
│   │   ├── orchestratorV2.ts # Scale-optimised orchestrator
│   │   ├── rallyAgent.ts     # Rally ticket requirement extractor
│   │   ├── textInputAgent.ts # Free-text requirement parser
│   │   ├── featureAgent.ts   # Gherkin feature file generator
│   │   ├── stepAgent.ts      # Step definition generator
│   │   ├── selectorAgent.ts  # Selector additions generator
│   │   └── reviewerAgent.ts  # Output quality reviewer
│   ├── tools/
│   │   ├── rallyTool.ts      # Rally API client + mock
│   │   └── contextScanner.ts # Scans existing Cypress files
│   ├── context/
│   │   └── contextManager.ts # Smart context filtering for scale
│   ├── config/
│   │   └── config.ts         # Config loader + agent system prompt
│   └── utils/
│       ├── fileWriter.ts     # Writes/patches output files
│       ├── batchProcessor.ts # Batch job runner with resume support
│       └── logger.ts         # Coloured console logger
└── examples/
    ├── features/login.feature
    ├── steps/loginSteps.ts
    ├── selectors/loginSelectors.ts
    ├── selectors/dashboardSelectors.ts
    ├── batch-manifest.json
    └── rally-tickets.txt
```

---

## Scaling to 1000+ Features

The `ContextManager` solves the scale problem:

- **Full scan, smart filter**: Scans all files but only sends relevant context to the AI
- **Tiered context**: Step patterns (compact list) + relevant selector files (full) + related scenario names
- **Keyword scoring**: Ranks existing files by semantic overlap with requirements
- **Batch processor**: Resume-capable batch runner with rate limiting and failure isolation
- **Domain grouping**: Groups related tickets together so generated tests build context on each other

---

## Extending

### Add a new input source (e.g. Jira)

1. Create `src/tools/jiraTool.ts` (same interface as `rallyTool.ts`)
2. Create `src/agents/jiraAgent.ts` (same interface as `rallyAgent.ts`)
3. Add `--jira-url` option to `src/index.ts`

### Add a custom review rule

Edit `src/agents/reviewerAgent.ts` — add your rule to the REVIEW CHECKLIST in the prompt.

### Change AI model

Set `AI_MODEL=claude-opus-4-5` in `.env` (or any Anthropic model string).
