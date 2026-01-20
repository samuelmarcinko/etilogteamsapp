// Navigation component for multi-tab app
const NAV_ITEMS = {
  en: [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', url: '/pages/dashboard.html' },
    { id: 'create', icon: '➕', label: 'Create Request', url: '/pages/create.html' },
    { id: 'my-requests', icon: '📋', label: 'My Requests', url: '/pages/my-requests.html' },
    { id: 'approvals', icon: '✅', label: 'Approvals', url: '/pages/approvals.html' }
  ],
  sk: [
    { id: 'dashboard', icon: '📊', label: 'Nástenka', url: '/pages/dashboard.html' },
    { id: 'create', icon: '➕', label: 'Vytvoriť žiadosť', url: '/pages/create.html' },
    { id: 'my-requests', icon: '📋', label: 'Moje žiadosti', url: '/pages/my-requests.html' },
    { id: 'approvals', icon: '✅', label: 'Schvaľovanie', url: '/pages/approvals.html' }
  ]
};

// Global variable to store pending approvals count
let pendingApprovalsCount = 0;

// Fetch pending approvals count for current user
async function fetchPendingApprovalsCount() {
  try {
    await microsoftTeams.app.initialize();
    const context = await microsoftTeams.app.getContext();
    const userId = context.user.id;

    const response = await fetch(`/api/tickets?assignedApproverId=${userId}&status=Pending`);
    const result = await response.json();
    const tickets = result.data || [];

    pendingApprovalsCount = tickets.length;
    updateNavigationBadge();

    return pendingApprovalsCount;
  } catch (error) {
    console.error('Error fetching pending approvals count:', error);
    return 0;
  }
}

// Update navigation badge with current count
function updateNavigationBadge() {
  const badge = document.querySelector('.notification-badge');
  if (badge) {
    if (pendingApprovalsCount > 0) {
      badge.textContent = pendingApprovalsCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

// Render navigation
function renderNavigation(currentPage) {
  const lang = localStorage.getItem('appLanguage') || 'en';
  const items = NAV_ITEMS[lang];

  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.innerHTML = items.map(item => `
    <a href="${item.url}" class="nav-item ${currentPage === item.id ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
      ${item.id === 'approvals' ? `<span class="notification-badge" style="display: none;">${pendingApprovalsCount}</span>` : ''}
    </a>
  `).join('');

  return nav;
}

// Initialize navigation on page load
document.addEventListener('DOMContentLoaded', async () => {
  const navContainer = document.getElementById('navContainer');
  if (navContainer) {
    const currentPage = document.body.getAttribute('data-page');
    navContainer.appendChild(renderNavigation(currentPage));

    // Fetch pending approvals count initially
    await fetchPendingApprovalsCount();

    // Update count every 30 seconds
    setInterval(fetchPendingApprovalsCount, 30000);
  }
});

// Make fetchPendingApprovalsCount available globally for manual refresh
window.refreshApprovalsBadge = fetchPendingApprovalsCount;
