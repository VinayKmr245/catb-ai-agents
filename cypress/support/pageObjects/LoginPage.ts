// cypress/support/pageObjects/LoginPage.ts

export class LoginPage {
  private readonly emailInput    = '[data-testid="login-email-input"]';
  private readonly passwordInput = '[data-testid="login-password-input"]';
  private readonly submitButton  = '[data-testid="login-submit-btn"]';
  private readonly errorMessage  = '[data-testid="login-error-message"]';
  private readonly validationMsg = '[data-testid="form-validation-message"]';

  visit(): void {
    cy.visit('/login');
  }

  enterEmail(email: string): void {
    cy.get(this.emailInput).clear().type(email);
  }

  enterPassword(password: string): void {
    cy.get(this.passwordInput).clear().type(password);
  }

  submit(): void {
    cy.get(this.submitButton).click();
  }

  shouldShowError(message: string): void {
    cy.get(this.errorMessage).should('be.visible').and('contain.text', message);
  }

  shouldShowValidation(message: string): void {
    cy.get(this.validationMsg).should('be.visible').and('contain.text', message);
  }

  submitButtonShouldBeDisabled(): void {
    cy.get(this.submitButton).should('be.disabled');
  }
}
