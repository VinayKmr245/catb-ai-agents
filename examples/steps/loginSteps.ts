// examples/steps/loginSteps.ts
import { Given, When, Then } from "@badeball/cypress-cucumber-preprocessor";
import { loginSelectors as sel } from "../../cypress/support/selectors/loginSelectors";

Given("the user is on the login page", () => {
  cy.visit("/login");
  cy.get(sel.loginForm).should("be.visible");
});

When("the user enters valid credentials", () => {
  cy.get(sel.usernameInput).clear().type("testuser@example.com");
  cy.get(sel.passwordInput).clear().type("SecurePass123!");
});

When("the user enters an invalid password", () => {
  cy.get(sel.usernameInput).clear().type("testuser@example.com");
  cy.get(sel.passwordInput).clear().type("wrongpassword");
});

When("the user clicks the submit button", () => {
  cy.get(sel.submitButton).click();
});

When("the user clicks the submit button without entering credentials", () => {
  cy.get(sel.usernameInput).clear();
  cy.get(sel.passwordInput).clear();
  cy.get(sel.submitButton).click();
});

Then("the user should be redirected to the dashboard", () => {
  cy.url().should("include", "/dashboard");
});

Then("the welcome message should be displayed", () => {
  cy.get(sel.welcomeMessage).should("be.visible");
});

Then("an error message should be displayed", () => {
  cy.get(sel.errorMessage).should("be.visible");
});

Then("the user should remain on the login page", () => {
  cy.url().should("include", "/login");
});

Then("validation errors should be displayed for required fields", () => {
  cy.get(sel.usernameError).should("be.visible");
  cy.get(sel.passwordError).should("be.visible");
});
