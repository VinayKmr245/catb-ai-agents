@regression @auth
Feature: UserLogin

  Background:
    Given the user is on the login page

  @smoke
  Scenario: Successful login with valid credentials
    When the user enters valid credentials
    And the user clicks the login button
    Then the user should be redirected to the dashboard

  Scenario: Login fails with incorrect password
    When the user enters an invalid password
    And the user clicks the login button
    Then an error message "Invalid credentials" should be displayed

  Scenario Outline: Login fails with missing fields
    When the user enters "<email>" as email and "<password>" as password
    And the user clicks the login button
    Then the validation message "<message>" should be displayed

    Examples:
      | email            | password | message              |
      |                  | secret   | Email is required    |
      | user@example.com |          | Password is required |
