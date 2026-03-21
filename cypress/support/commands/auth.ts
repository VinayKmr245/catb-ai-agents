// cypress/support/commands/auth.ts

declare global {
  namespace Cypress {
    interface Chainable {
      loginByApi(email: string, password: string): Chainable<void>;
      logout(): Chainable<void>;
      seedTestUser(role?: 'admin' | 'user'): Chainable<{ email: string; password: string }>;
    }
  }
}

Cypress.Commands.add('loginByApi', (email: string, password: string) => {
  cy.request('POST', '/api/auth/login', { email, password }).then(resp => {
    window.localStorage.setItem('auth_token', resp.body.token);
  });
});

Cypress.Commands.add('logout', () => {
  window.localStorage.removeItem('auth_token');
  cy.visit('/login');
});

Cypress.Commands.add('seedTestUser', (role = 'user') => {
  return cy.task('seedUser', { role });
});

export {};
