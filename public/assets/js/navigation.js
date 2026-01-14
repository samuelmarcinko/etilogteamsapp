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
    </a>
  `).join('');
  
  return nav;
}

// Initialize navigation on page load
document.addEventListener('DOMContentLoaded', () => {
  const navContainer = document.getElementById('navContainer');
  if (navContainer) {
    const currentPage = document.body.getAttribute('data-page');
    navContainer.appendChild(renderNavigation(currentPage));
  }
});
