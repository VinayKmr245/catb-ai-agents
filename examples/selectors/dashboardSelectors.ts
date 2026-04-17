// examples/selectors/dashboardSelectors.ts
export const dashboardSelectors = {
  // Navigation
  navBar: '[data-cy="nav-bar"]',
  navLogo: '[data-cy="nav-logo"]',
  navProfileMenu: '[data-cy="nav-profile-menu"]',
  navNotificationBell: '[data-cy="nav-notification-bell"]',
  navLogoutBtn: '[data-cy="nav-logout-btn"]',

  // Sidebar
  sidebar: '[data-cy="sidebar"]',
  sidebarToggle: '[data-cy="sidebar-toggle"]',
  sidebarHomeLink: '[data-cy="sidebar-home-link"]',
  sidebarReportsLink: '[data-cy="sidebar-reports-link"]',
  sidebarSettingsLink: '[data-cy="sidebar-settings-link"]',

  // Main content
  pageTitle: '[data-cy="page-title"]',
  loadingSpinner: '[data-cy="loading-spinner"]',
  errorBanner: '[data-cy="error-banner"]',
  successToast: '[data-cy="success-toast"]',

  // Stats cards
  statsContainer: '[data-cy="stats-container"]',
  statsTotalUsers: '[data-cy="stats-total-users"]',
  statsActiveToday: '[data-cy="stats-active-today"]',
  statsRevenue: '[data-cy="stats-revenue"]',
};
