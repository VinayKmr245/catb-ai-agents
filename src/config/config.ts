// src/config/config.ts
import * as dotenv from "dotenv";
import * as path from "path";
import type { AgentConfig, ProjectConfig } from "../types";

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is not set in environment`);
  return val;
}

export function getAgentConfig(): AgentConfig {
  return {
    provider: "azure" as const,
    apiKey: requireEnv("AZURE_OPENAI_API_KEY"),
    azureEndpoint: requireEnv("AZURE_OPENAI_ENDPOINT"),       // e.g. https://my-resource.openai.azure.com
    azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01",
    model: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",   // kept for compatibility
    maxTokens: parseInt(process.env.MAX_TOKENS ?? "8192"),
    maxIterations: parseInt(process.env.MAX_ITERATIONS ?? "10"),
  };
}

export function getProjectConfig(): ProjectConfig {
  return {
    cypressRoot: path.resolve(process.env.CYPRESS_ROOT ?? "./cypress"),
    featuresDir: path.resolve(process.env.FEATURES_DIR ?? "./cypress/e2e/features"),
    stepsDir: path.resolve(process.env.STEPS_DIR ?? "./cypress/e2e/step_definitions"),
    selectorsDir: path.resolve(process.env.SELECTORS_DIR ?? "./cypress/support/selectors"),
    rallyBaseUrl: process.env.RALLY_BASE_URL ?? "https://rally1.rallydev.com/slm/webservice/v2.0",
    rallyApiKey: process.env.RALLY_API_KEY ?? "",
  };
}

export const AGENT_SYSTEM_PROMPT = `You are an expert Cypress Cucumber test automation engineer with deep knowledge of:
- Gherkin syntax (Feature files with Given/When/Then scenarios)
- Cypress step definitions using @badeball/cypress-cucumber-preprocessor
- Selector pattern design with data-cy attributes

YOUR STRICT RULES:
1. ALWAYS reuse existing step definitions - never create duplicates
2. New step patterns MUST follow Given/When/Then naming conventions — NEVER use And or But as a keyword
3. Selectors MUST use data-cy attributes: export const xyzSelectors = { key: '[data-cy="value"]' }
4. Only generate new steps if NO existing step covers the behavior
5. Keep steps atomic and single-responsibility
6. Feature files must use Background for shared setup steps
7. Scenarios must be independent and not share state
8. Step function bodies must use selector references (sel.*) — never hardcode selectors

SELECTOR PATTERN:
export const loginSelectors = {
  usernameInput: '[data-cy="username"]',
  passwordInput: '[data-cy="password"]',
  submitButton: '[data-cy="login-submit"]',
};

STEP DEFINITION PATTERN:
import { Given, When, Then } from "@badeball/cypress-cucumber-preprocessor";
import { loginSelectors as sel } from "../../support/selectors/loginSelectors";

Given("the user is on the login page", () => {
  cy.visit("/login");
});

When("the user enters valid credentials", () => {
  cy.get(sel.usernameInput).type("testuser");
  cy.get(sel.passwordInput).type("password123");
});

FEATURE FILE PATTERN:
Feature: Login
  As a user
  I want to log in
  So that I can access the application

  Background:
    Given the user is on the login page

  Scenario: Successful login with valid credentials
    When the user enters valid credentials
    And the user clicks the submit button
    Then the user should be redirected to the dashboard`;
