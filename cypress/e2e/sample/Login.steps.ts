// cypress/e2e/sample/Login.steps.ts

import { Given, When, Then } from '@badeball/cypress-cucumber-preprocessor';
import { LoginPage } from '../../support/pageObjects/LoginPage';

const loginPage = new LoginPage();

/** Navigates to the application login page */
Given('the user is on the login page', () => {
  loginPage.visit();
});

/** Fills in pre-seeded valid test credentials */
When('the user enters valid credentials', () => {
  loginPage.enterEmail(Cypress.env('TEST_USER_EMAIL'));
  loginPage.enterPassword(Cypress.env('TEST_USER_PASSWORD'));
});

/** Fills in valid email but a wrong password */
When('the user enters an invalid password', () => {
  loginPage.enterEmail(Cypress.env('TEST_USER_EMAIL'));
  loginPage.enterPassword('wrong-password-123');
});

/** Fills email and password fields — empty string means leave blank */
When('the user enters {string} as email and {string} as password', (email: string, password: string) => {
  if (email)    loginPage.enterEmail(email);
  if (password) loginPage.enterPassword(password);
});

/** Clicks the main login submit button */
When('the user clicks the login button', () => {
  loginPage.submit();
});

/** Verifies the post-login redirect reaches /dashboard */
Then('the user should be redirected to the dashboard', () => {
  cy.url().should('include', '/dashboard');
});

/** Verifies an inline error message with the given text is visible */
Then('an error message {string} should be displayed', (message: string) => {
  cy.get('[data-testid="login-error-message"]')
    .should('be.visible')
    .and('contain.text', message);
});

/** Verifies a form-level validation message */
Then('the validation message {string} should be displayed', (message: string) => {
  cy.get('[data-testid="form-validation-message"]')
    .should('be.visible')
    .and('contain.text', message);
});
