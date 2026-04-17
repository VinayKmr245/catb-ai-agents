@authentication
Feature: User Login
  As a registered user
  I want to log in to the application
  So that I can access my account and features

  Background:
    Given the user is on the login page

  @smoke @happy-path
  Scenario: Successful login with valid credentials
    When the user enters valid credentials
    And the user clicks the submit button
    Then the user should be redirected to the dashboard
    And the welcome message should be displayed

  @error-handling
  Scenario: Login fails with invalid password
    When the user enters an invalid password
    And the user clicks the submit button
    Then an error message should be displayed
    And the user should remain on the login page

  @validation
  Scenario: Login fails with empty fields
    When the user clicks the submit button without entering credentials
    Then validation errors should be displayed for required fields
