// Navigation component for multi-tab app
const NAV_ITEMS = {
  en: [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', url: '/pages/dashboard.html' },
    { id: 'create', icon: '➕', label: 'Create Request', url: '/pages/create.html' },
    { id: 'my-requests', icon: '📋', label: 'My Requests', url: '/pages/my-requests.html' },
    { id: 'upcoming-time-off', icon: '📅', label: 'Team Calendar', url: '/pages/upcoming-time-off.html' },
    { id: 'approvals', icon: '✅', label: 'Approve Requests', url: '/pages/approvals.html' },
    { id: 'sick-notes', icon: '🏥', label: 'Paragraphs & FMC', url: '/pages/sick-notes.html' }
  ],
  sk: [
    { id: 'dashboard', icon: '📊', label: 'Nástenka', url: '/pages/dashboard.html' },
    { id: 'create', icon: '➕', label: 'Vytvoriť žiadosť', url: '/pages/create.html' },
    { id: 'my-requests', icon: '📋', label: 'Moje žiadosti', url: '/pages/my-requests.html' },
    { id: 'upcoming-time-off', icon: '📅', label: 'Teamový kalendár', url: '/pages/upcoming-time-off.html' },
    { id: 'approvals', icon: '✅', label: 'Schvaľovanie žiadostí', url: '/pages/approvals.html' },
    { id: 'sick-notes', icon: '🏥', label: 'Paragrafy & OČR', url: '/pages/sick-notes.html' }
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

// Update scroll fade indicators based on scroll position
function updateScrollFades(scrollArea) {
  const wrapper = scrollArea.closest('.nav-wrapper');
  if (!wrapper) return;

  const scrollLeft = scrollArea.scrollLeft;
  const maxScroll = scrollArea.scrollWidth - scrollArea.clientWidth;

  wrapper.classList.toggle('fade-left', scrollLeft > 8);
  wrapper.classList.toggle('fade-right', scrollLeft < maxScroll - 8);
}

// Render navigation
function renderNavigation(currentPage) {
  const lang = localStorage.getItem('appLanguage') || 'en';
  const items = NAV_ITEMS[lang];

  const portalLabel = lang === 'sk' ? 'Web rozhranie' : 'Web Portal';

  // Top-level container for everything
  const container = document.createElement('div');

  // Utility bar (portal link + language switcher) - outside nav, top-left
  const utilityBar = document.createElement('div');
  utilityBar.className = 'nav-utility-bar';
  utilityBar.innerHTML = `
    <a href="https://teams.etilog.com/login" target="_blank" class="nav-portal-link">
      <span class="nav-portal-icon">&#127760;</span>${portalLabel}
    </a>
    <div class="nav-lang-switcher">
      <button class="lang-btn ${lang === 'en' ? 'active' : ''}" data-lang="en" onclick="switchLanguage('en')">EN</button>
      <button class="lang-btn ${lang === 'sk' ? 'active' : ''}" data-lang="sk" onclick="switchLanguage('sk')">SK</button>
    </div>
  `;

  // Outer wrapper for nav with fade indicators
  const wrapper = document.createElement('div');
  wrapper.className = 'nav-wrapper';

  // Scrollable nav area - only navigation items
  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.innerHTML = items.map(item => `
    <a href="${item.url}" class="nav-item ${currentPage === item.id ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
      ${item.id === 'approvals' ? `<span class="notification-badge" style="display: none;">${pendingApprovalsCount}</span>` : ''}
    </a>
  `).join('');

  wrapper.appendChild(nav);

  container.appendChild(utilityBar);
  container.appendChild(wrapper);

  // Set up scroll fade indicators after rendering
  requestAnimationFrame(() => {
    updateScrollFades(nav);
    nav.addEventListener('scroll', () => updateScrollFades(nav), { passive: true });
    window.addEventListener('resize', () => updateScrollFades(nav), { passive: true });
  });

  return container;
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
