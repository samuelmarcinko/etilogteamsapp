/**
 * ETILOG Portal - Single Page Application
 * Handles routing, page rendering, and all portal functionality
 * Fully bilingual SK/EN via portalI18n.js
 */

let portalUser = null;
let currentPage = 'dashboard';

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Set active language button
    document.querySelectorAll('.portal-lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === portalLang);
    });

    if (!isLoggedIn()) {
        window.location.href = '/login';
        return;
    }

    const profileLoaded = await loadUserProfile();
    if (!profileLoaded) {
        document.getElementById('pageLoading').style.display = 'none';
        document.getElementById('pageContent').innerHTML = `
            <div class="page-body">
                <div class="empty-state">
                    <div class="empty-icon">&#9888;</div>
                    <div class="empty-text">${pt('profileLoadFailed')}</div>
                    <br><button class="btn btn-primary" onclick="handleLogout()">${pt('logoutRetry')}</button>
                </div>
            </div>`;
        return;
    }

    updateSidebarLanguage();
    setupNavigation();
    navigateToPage(window.location.hash.slice(1) || 'hub');
});

async function loadUserProfile() {
    try {
        const response = await apiCall('/api/admin/me');
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error('Profile load failed:', response.status, errData);
            throw new Error(errData.message || `HTTP ${response.status}`);
        }
        const result = await response.json();
        portalUser = result.data;

        localStorage.setItem('etilog_user', JSON.stringify(portalUser));

        document.getElementById('userName').textContent = portalUser.name || portalUser.email;
        document.getElementById('userRoleBadge').textContent = portalUser.role;
        document.getElementById('userAvatar').textContent = getInitials(portalUser.name || portalUser.email);

        // Note: module/role-based sidebar visibility handled by applyModulePreset()
        return true;
    } catch (error) {
        console.error('Failed to load profile:', error);
        showToast(pt('profileLoadFailed') + ': ' + error.message, 'error');
        return false;
    }
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// ============================================
// NAVIGATION
// ============================================

function setupNavigation() {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateToPage(page);
        });
    });

    window.addEventListener('hashchange', () => {
        navigateToPage(window.location.hash.slice(1) || 'hub');
    });
}

// Map each page to its parent module
const PAGE_MODULE = {
    'dashboard': 'hr', 'my-quotas': 'hr', 'my-sick-notes': 'hr',
    'my-requests': 'hr', 'my-approvals': 'hr',
    'admin-employees': 'hr', 'admin-quotas': 'hr', 'admin-sick-notes': 'hr',
    'admin-tickets': 'hr', 'admin-dashboard': 'hr', 'admin-ticket-types': 'hr',
    'admin-system': 'hr',
    'admin-fleet': 'fleet',
    'warehouse-dashboard': 'warehouse', 'warehouse-materials': 'warehouse',
    'warehouse-movements': 'warehouse', 'warehouse-audit': 'warehouse'
};

/**
 * Show only the sidebar block for the given module, role-gated.
 */
function applyModulePreset(module) {
    // Hide all module nav blocks
    ['hrNav', 'fleetNav', 'warehouseNav'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (module === 'hr') {
        document.getElementById('hrNav').style.display = 'block';
        // Role-gate HR admin sub-sections
        const role = portalUser?.role;
        document.getElementById('managerNav').style.display =
            (role === 'spravca' || role === 'admin') ? 'block' : 'none';
        document.getElementById('adminNav').style.display =
            (role === 'admin') ? 'block' : 'none';
    } else if (module === 'fleet') {
        document.getElementById('fleetNav').style.display = 'block';
    } else if (module === 'warehouse') {
        document.getElementById('warehouseNav').style.display = 'block';
        // Audit sub-section is admin only
        const waNav = document.getElementById('warehouseAdminNav');
        if (waNav) waNav.style.display = (portalUser?.role === 'admin') ? 'block' : 'none';
    }
}

function navigateToPage(page) {
    if (!page) page = 'hub';

    // Pages accessible to spravca role
    const spravcaPages = ['admin-employees', 'admin-quotas', 'admin-sick-notes', 'admin-tickets'];

    // Warehouse pages require warehouse module access (admin or sklad)
    if (page.startsWith('warehouse-') && !hasModuleAccess('warehouse')) {
        showToast(pt('accessDenied'), 'error');
        return;
    }
    // Audit sub-page is admin only
    if (page === 'warehouse-audit' && portalUser?.role !== 'admin') {
        showToast(pt('accessDenied'), 'error');
        return;
    }

    if (page.startsWith('admin-')) {
        const userRole = portalUser?.role;
        // Fleet is its own module - admin only
        if (page === 'admin-fleet') {
            if (userRole !== 'admin') {
                showToast(pt('accessDenied'), 'error');
                return;
            }
        } else if (userRole === 'admin') {
            // Admin has full access
        } else if (userRole === 'spravca' && spravcaPages.includes(page)) {
            // Spravca has limited access
        } else {
            showToast(pt('accessDenied'), 'error');
            return;
        }
    }

    currentPage = page;
    window.location.hash = page;

    // Toggle hub layout (hide sidebar on hub page)
    document.body.classList.toggle('hub-active', page === 'hub');

    // Apply the sidebar preset for this page's module
    if (page !== 'hub') {
        applyModulePreset(PAGE_MODULE[page] || 'hr');
    }

    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');

    document.getElementById('sidebar').classList.remove('open');

    renderPage(page);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

async function handleLogout() {
    await signOut();
}

// ============================================
// PAGE RENDERER
// ============================================

async function renderPage(page) {
    const content = document.getElementById('pageContent');
    const loading = document.getElementById('pageLoading');

    loading.style.display = 'flex';
    content.innerHTML = '';

    try {
        switch (page) {
            case 'hub': await renderHub(content); break;
            case 'dashboard': await renderDashboard(content); break;
            case 'my-quotas': await renderMyQuotas(content); break;
            case 'my-sick-notes': await renderMySickNotes(content); break;
            case 'my-requests': await renderMyRequests(content); break;
            case 'my-approvals': await renderMyApprovals(content); break;
            case 'admin-dashboard': await renderAdminDashboard(content); break;
            case 'admin-employees': await renderAdminEmployees(content); break;
            case 'admin-quotas': await renderAdminQuotas(content); break;
            case 'admin-sick-notes': await renderAdminSickNotes(content); break;
            case 'admin-tickets': await renderAdminTickets(content); break;
            case 'admin-ticket-types': await renderAdminTicketTypes(content); break;
            case 'admin-system': await renderAdminSystem(content); break;
            case 'admin-fleet': await renderAdminFleet(content); break;
            case 'warehouse-dashboard': await renderWarehouseDashboard(content); break;
            case 'warehouse-materials': await renderWarehouseMaterials(content); break;
            case 'warehouse-movements': await renderWarehouseMovements(content); break;
            case 'warehouse-audit': await renderWarehouseAudit(content); break;
            default: content.innerHTML = `<div class="page-body"><div class="empty-state"><div class="empty-icon">&#128533;</div><div class="empty-text">${pt('pageNotFound')}</div></div></div>`;
        }
    } catch (error) {
        console.error('Page render error:', error);
        content.innerHTML = `<div class="page-body"><div class="empty-state"><div class="empty-icon">&#9888;</div><div class="empty-text">${pt('pageLoadError')}: ${error.message}</div></div></div>`;
    }

    loading.style.display = 'none';
}

// ============================================
// MODULE HUB
// ============================================

/**
 * Check if user has access to a module.
 * - admin: all modules
 * - spravca: HR only
 * - user: HR only
 * - warehouse module: coming soon (no access yet)
 */
function hasModuleAccess(module) {
    const role = portalUser?.role;
    if (role === 'admin') return true;
    if (module === 'hr') return true; // All roles have HR access
    if (module === 'fleet') return role === 'admin';
    if (module === 'warehouse') return role === 'sklad';
    return false;
}

function enterModule(module) {
    if (!hasModuleAccess(module)) {
        openModal(pt('hubAccessDenied'), `
            <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">&#128274;</div>
                <p>${pt('hubAccessDeniedMsg')}</p>
            </div>
        `, `<button class="btn btn-secondary" onclick="closeModal()">${pt('close')}</button>`);
        return;
    }

    // Navigate to module's default page
    if (module === 'hr') navigateToPage('dashboard');
    if (module === 'fleet') navigateToPage('admin-fleet');
    if (module === 'warehouse') navigateToPage('warehouse-dashboard');
}

async function renderHub(container) {
    const role = portalUser?.role || 'user';
    const hrAccess = hasModuleAccess('hr');
    const fleetAccess = hasModuleAccess('fleet');

    // Determine badge for each module
    const warehouseAccess = hasModuleAccess('warehouse');
    const hrBadge = hrAccess ? 'available' : 'locked';
    const fleetBadge = fleetAccess ? 'available' : 'locked';
    const warehouseBadge = warehouseAccess ? 'available' : 'locked';

    container.innerHTML = `
        <div class="hub-layout">
            <div class="hub-header">
                <img src="/assets/images/logo.png" alt="ETILOG" class="hub-logo">
                <h1 class="hub-title">${pt('hubTitle')}</h1>
                <p class="hub-subtitle">${pt('hubSubtitle')}</p>
            </div>

            <div class="hub-grid">
                <!-- HR Module -->
                <div class="hub-card hr" onclick="enterModule('hr')">
                    <div class="hub-card-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                    </div>
                    <h3 class="hub-card-title">${pt('hubModuleHR')}</h3>
                    <p class="hub-card-desc">${pt('hubModuleHRDesc')}</p>
                    <span class="hub-card-badge ${hrBadge}">${pt('hubBadge' + hrBadge.charAt(0).toUpperCase() + hrBadge.slice(1).replace('-s', 'S'))}</span>
                </div>

                <!-- Fleet Module -->
                <div class="hub-card fleet" onclick="enterModule('fleet')">
                    <div class="hub-card-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 17h14M5 17a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 1.5L19 10h-3v4h3l1 3a1 1 0 0 1-1 1h-1"/>
                            <circle cx="7.5" cy="17" r="2"/>
                            <circle cx="16.5" cy="17" r="2"/>
                        </svg>
                    </div>
                    <h3 class="hub-card-title">${pt('hubModuleFleet')}</h3>
                    <p class="hub-card-desc">${pt('hubModuleFleetDesc')}</p>
                    <span class="hub-card-badge ${fleetBadge}">${pt('hubBadge' + fleetBadge.charAt(0).toUpperCase() + fleetBadge.slice(1).replace('-s', 'S'))}</span>
                </div>

                <!-- Warehouse Module -->
                <div class="hub-card warehouse" onclick="enterModule('warehouse')">
                    <div class="hub-card-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 21h18"/>
                            <path d="M3 7v14"/>
                            <path d="M21 7v14"/>
                            <path d="M3 7l9-4 9 4"/>
                            <path d="M8 14h8"/>
                            <path d="M8 10h8"/>
                            <path d="M8 18h8"/>
                        </svg>
                    </div>
                    <h3 class="hub-card-title">${pt('hubModuleWarehouse')}</h3>
                    <p class="hub-card-desc">${pt('hubModuleWarehouseDesc')}</p>
                    <span class="hub-card-badge ${warehouseBadge}">${pt('hubBadge' + warehouseBadge.charAt(0).toUpperCase() + warehouseBadge.slice(1))}</span>
                </div>
            </div>

            <div class="hub-user-footer">
                <div class="hub-user-avatar">${getInitials(portalUser.name || portalUser.email)}</div>
                <div class="hub-user-info">
                    <div class="hub-user-name">${escapeHtml(portalUser.name || portalUser.email)}</div>
                    <div class="hub-user-role">${portalUser.role}</div>
                </div>
                <button class="hub-logout-btn" onclick="handleLogout()">${pt('btnLogout')}</button>
            </div>
        </div>
    `;
}

// ============================================
// USER DASHBOARD
// ============================================

async function renderDashboard(container) {
    const year = new Date().getFullYear();

    const [quotaRes, requestsRes] = await Promise.all([
        apiCall(`/api/quotas/me?year=${year}`),
        apiCall(`/api/tickets?createdById=${portalUser.id}`)
    ]);

    const quota = (await quotaRes.json()).data;
    const tickets = (await requestsRes.json()).data || [];

    const pending = tickets.filter(t => t.status === 'Pending').length;
    const approved = tickets.filter(t => t.status === 'Approved').length;

    const vacUsedPct = quota ? Math.round((parseFloat(quota.vacation_days_used) / quota.vacation_days_total) * 100) : 0;
    const parUsedPct = quota ? Math.round((parseFloat(quota.paragraph_days_used || 0) / (quota.paragraph_days_total || 7)) * 100) : 0;
    const ocrUsedPct = quota ? Math.round((parseFloat(quota.ocr_days_used || 0) / (quota.ocr_days_total || 7)) * 100) : 0;

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('dashboardTitle')}</h1><p>${pt('dashboardWelcome')}, ${portalUser.name || portalUser.email}</p></div>
        </div>
        <div class="page-body">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">&#127796;</div>
                    <div><div class="stat-value">${quota ? quota.vacation_days_remaining : '-'}</div><div class="stat-label">${pt('vacationRemaining')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background:#dbeafe;color:#2563eb;">&#167;</div>
                    <div><div class="stat-value">${quota ? Number(quota.paragraph_days_remaining).toFixed(2) : '-'}</div><div class="stat-label">${pt('paragraphRemaining')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background:#fef3c7;color:#d97706;">&#128106;</div>
                    <div><div class="stat-value">${quota ? Number(quota.ocr_days_remaining).toFixed(2) : '-'}</div><div class="stat-label">${pt('ocrRemaining')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">&#9989;</div>
                    <div><div class="stat-value">${approved}</div><div class="stat-label">${pt('approvedRequests')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">&#9203;</div>
                    <div><div class="stat-value">${pending}</div><div class="stat-label">${pt('pendingRequests')}</div></div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>${pt('myQuotasYear')} ${year}</h2>
                </div>
                <div class="card-body">
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>${pt('vacation')}</span>
                            <span><strong>${quota ? quota.vacation_days_remaining : '-'} ${pt('days')}</strong> ${pt('quotaRemaining')}</span>
                        </div>
                    </div>
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>${pt('sickNoteDocTypeParagraph') || 'Paragraf'}</span>
                            <span>${quota ? parseFloat(quota.paragraph_days_used || 0).toFixed(2) : '0.00'} / ${quota ? (quota.paragraph_days_total || 7) : 7} ${pt('hours')}</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${parUsedPct > 90 ? 'red' : parUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(parUsedPct, 100)}%"></div>
                        </div>
                    </div>
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>${pt('sickNoteDocTypeOcr') || 'OČR'}</span>
                            <span>${quota ? parseFloat(quota.ocr_days_used || 0).toFixed(2) : '0.00'} / ${quota ? (quota.ocr_days_total || 7) : 7} ${pt('hours')}</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${ocrUsedPct > 90 ? 'red' : ocrUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(ocrUsedPct, 100)}%"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>${pt('recentRequests')}</h2>
                </div>
                <div class="card-body">
                    ${tickets.length > 0 ? `
                        <table class="data-table">
                            <thead>
                                <tr><th>${pt('colName')}</th><th>${pt('colType')}</th><th>${pt('colStatus')}</th><th>${pt('colDate')}</th></tr>
                            </thead>
                            <tbody>
                                ${tickets.slice(0, 10).map(t => `
                                    <tr>
                                        <td><strong>${escapeHtml(t.title)}</strong></td>
                                        <td><span class="badge badge-${{'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[t.ticket_type] || 'user'}">${translateType(t.ticket_type)}</span></td>
                                        <td><span class="badge badge-${t.status.toLowerCase()}">${translateStatus(t.status)}</span></td>
                                        <td>${formatDate(t.created_at)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : `<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">${pt('noRequests')}</div></div>`}
                </div>
            </div>
        </div>
    `;
}

// ============================================
// MY QUOTAS
// ============================================

async function renderMyQuotas(container) {
    const year = new Date().getFullYear();
    const [quotaRes, holidaysRes] = await Promise.all([
        apiCall(`/api/quotas/me?year=${year}`),
        apiCall(`/api/quotas/holidays?year=${year}`)
    ]);

    const quota = (await quotaRes.json()).data;
    const holidays = (await holidaysRes.json()).data || [];

    const vacUsedPct = quota ? Math.round((parseFloat(quota.vacation_days_used) / quota.vacation_days_total) * 100) : 0;
    const parUsedPct = quota ? Math.round((parseFloat(quota.paragraph_days_used || 0) / (quota.paragraph_days_total || 7)) * 100) : 0;
    const ocrUsedPct = quota ? Math.round((parseFloat(quota.ocr_days_used || 0) / (quota.ocr_days_total || 7)) * 100) : 0;

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('myQuotasTitle')}</h1><p>${pt('myQuotasDesc')} ${year}</p></div>
        </div>
        <div class="page-body">
            <div class="quota-card">
                <div class="quota-icon">&#127796;</div>
                <div class="quota-details">
                    <div class="quota-type">${pt('vacation')}</div>
                    <div class="quota-numbers">
                        <span>${pt('quotaRemaining')}: <strong>${quota ? quota.vacation_days_remaining : '-'} ${pt('days')}</strong></span>
                    </div>
                </div>
            </div>

            <div class="quota-card">
                <div class="quota-icon" style="font-size:1.5rem;">&#167;</div>
                <div class="quota-details">
                    <div class="quota-type">${pt('sickNoteDocTypeParagraph') || 'Paragraf'}</div>
                    <div class="quota-numbers">
                        <span>${pt('quotaTotal')}: <strong>${quota ? (quota.paragraph_days_total || 7) : '-'} ${pt('hours')}</strong></span>
                        <span>${pt('quotaUsed')}: <strong>${quota ? parseFloat(quota.paragraph_days_used || 0).toFixed(2) : '0.00'} ${pt('hours')}</strong></span>
                        <span>${pt('quotaRemaining')}: <strong>${quota ? Number(quota.paragraph_days_remaining).toFixed(2) : '-'} ${pt('hours')}</strong></span>
                    </div>
                    <div class="quota-bar" style="margin-top: 0.75rem;">
                        <div class="quota-bar-fill ${parUsedPct > 90 ? 'red' : parUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(parUsedPct, 100)}%"></div>
                    </div>
                </div>
            </div>

            <div class="quota-card">
                <div class="quota-icon">&#128106;</div>
                <div class="quota-details">
                    <div class="quota-type">${pt('sickNoteDocTypeOcr') || 'OČR'}</div>
                    <div class="quota-numbers">
                        <span>${pt('quotaTotal')}: <strong>${quota ? (quota.ocr_days_total || 7) : '-'} ${pt('hours')}</strong></span>
                        <span>${pt('quotaUsed')}: <strong>${quota ? parseFloat(quota.ocr_days_used || 0).toFixed(2) : '0.00'} ${pt('hours')}</strong></span>
                        <span>${pt('quotaRemaining')}: <strong>${quota ? Number(quota.ocr_days_remaining).toFixed(2) : '-'} ${pt('hours')}</strong></span>
                    </div>
                    <div class="quota-bar" style="margin-top: 0.75rem;">
                        <div class="quota-bar-fill ${ocrUsedPct > 90 ? 'red' : ocrUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(ocrUsedPct, 100)}%"></div>
                    </div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>${pt('holidaysSR')} ${year}</h2>
                </div>
                <div class="card-body">
                    <table class="data-table">
                        <thead><tr><th>${pt('holidayColDate')}</th><th>${pt('holidayColName')}</th></tr></thead>
                        <tbody>
                            ${holidays.map(h => `
                                <tr><td>${formatDate(h.date)}</td><td>${escapeHtml(h.name)}</td></tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// MY SICK NOTES
// ============================================

async function renderMySickNotes(container) {
    const response = await apiCall('/api/sick-notes/me');
    const notes = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('mySickNotesTitle')}</h1><p>${pt('mySickNotesDesc')}</p></div>
            <button class="btn btn-primary" onclick="openNewSickNoteModal()">${pt('newSickNote')}</button>
        </div>
        <div class="page-body">
            ${notes.length > 0 ? `
                <div class="portal-card">
                    <div class="card-body" style="overflow-x:auto;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>${pt('sickNoteColName')}</th>
                                    <th>${pt('colDocType') || 'Typ'}</th>
                                    <th>${pt('colDate')}</th>
                                    <th>${pt('sickNoteColDoctor')}</th>
                                    <th>${pt('sickNoteColFile')}</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${notes.map(n => {
                                    const docLabel = n.document_type === 'ocr' ? (pt('sickNoteDocTypeOcr') || 'OČR') : (pt('sickNoteDocTypeParagraph') || 'Paragraf');
                                    const docBadge = n.document_type === 'ocr' ? 'badge-sick' : 'badge-paragraph';
                                    return `
                                    <tr>
                                        <td><strong>${escapeHtml(n.title)}</strong>${n.diagnosis ? `<br><small style="color:var(--gray-500)">${escapeHtml(n.diagnosis)}</small>` : ''}</td>
                                        <td><span class="badge ${docBadge}">${docLabel}</span></td>
                                        <td>${formatDate(n.start_date)}${n.end_date && n.end_date !== n.start_date ? ` - ${formatDate(n.end_date)}` : ''}</td>
                                        <td>${n.doctor_name ? escapeHtml(n.doctor_name) : '<span style="color:var(--gray-300)">—</span>'}</td>
                                        <td>${n.file_name ? `<button class="btn-file-link" onclick="return previewSickNoteFile(event, ${n.id}, '${escapeHtml(n.file_name)}')">&#128065; ${escapeHtml(n.file_name)}</button>` : '<span style="color:var(--gray-300)">—</span>'}</td>
                                        <td>
                                            <div class="table-actions">
                                                <button class="btn-icon primary" onclick="openUploadSickNoteModal(${n.id})" title="${pt('upload')}">&#128206;</button>
                                                <button class="btn-icon danger" onclick="deleteSickNote(${n.id})" title="${pt('delete')}">&#128465;</button>
                                            </div>
                                        </td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            ` : `<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">${pt('noSickNotes')}</div></div>`}
        </div>
    `;
}

async function openNewSickNoteModal() {
    document.getElementById('modalTitle').textContent = pt('newSickNoteTitle');
    document.getElementById('modalBody').innerHTML = `
        <form id="sickNoteForm">
            <div class="form-group">
                <label class="form-label">${pt('sickNoteFieldDocType')}</label>
                <select class="form-select" name="document_type" required>
                    <option value="paragraph">${pt('sickNoteDocTypeParagraph')}</option>
                    <option value="ocr">${pt('sickNoteDocTypeOcr')}</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${pt('sickNoteFieldTitle')}</label>
                <input type="text" class="form-input" name="title" required placeholder="${pt('sickNoteFieldTitlePlaceholder')}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('sickNoteFieldDateFrom')}</label>
                    <input type="date" class="form-input" name="start_date" required>
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('sickNoteFieldDateTo')}</label>
                    <input type="date" class="form-input" name="end_date" required>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${pt('sickNoteFieldDoctor')}</label>
                <input type="text" class="form-input" name="doctor_name" placeholder="${pt('sickNoteFieldDoctorPlaceholder')}">
            </div>
            <div class="form-group">
                <label class="form-label">${pt('sickNoteFieldDiagnosis')}</label>
                <input type="text" class="form-input" name="diagnosis" placeholder="${pt('sickNoteFieldDiagnosisPlaceholder')}">
            </div>
            <div class="form-group">
                <label class="form-label">${pt('sickNoteFieldDescription')}</label>
                <textarea class="form-textarea" name="description" rows="3" placeholder="${pt('sickNoteFieldDescriptionPlaceholder')}"></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">${pt('sickNoteFieldFile')}</label>
                <input type="file" class="form-input" name="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.bmp,.tiff,.tif">
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitSickNote()">${pt('save')}</button>
    `;
    openModal();
}

async function submitSickNote() {
    const form = document.getElementById('sickNoteForm');
    const formData = new FormData(form);

    try {
        const response = await apiCall('/api/sick-notes', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message);
        }

        showToast(pt('sickNoteCreated'), 'success');
        closeModal();
        navigateToPage('my-sick-notes');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function openUploadSickNoteModal(id) {
    document.getElementById('modalTitle').textContent = pt('uploadTitle');
    document.getElementById('modalBody').innerHTML = `
        <form id="uploadForm">
            <div class="form-group">
                <label class="form-label">${pt('uploadFileLabel')}</label>
                <div class="file-upload-area" onclick="document.getElementById('uploadFile').click()">
                    <div class="file-upload-icon">&#128206;</div>
                    <div class="file-upload-text">${pt('uploadDropzone')}<br><strong>${pt('uploadDropzoneFormats')}</strong> ${pt('uploadDropzoneSize')}</div>
                </div>
                <input type="file" id="uploadFile" name="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.bmp,.tiff,.tif" style="display:none" onchange="showFilePreview(this)">
                <div id="filePreview"></div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="uploadSickNoteFile(${id})">${pt('upload')}</button>
    `;
    openModal();
}

function showFilePreview(input) {
    const preview = document.getElementById('filePreview');
    if (input.files[0]) {
        const file = input.files[0];
        const sizeKb = Math.round(file.size / 1024);
        preview.innerHTML = `
            <div class="file-preview">
                <div class="file-preview-icon">${file.type.includes('pdf') ? '&#128196;' : '&#128247;'}</div>
                <div class="file-preview-name">${escapeHtml(file.name)}</div>
                <div class="file-preview-size">${sizeKb} KB</div>
            </div>
        `;
    }
}

async function uploadSickNoteFile(id) {
    const fileInput = document.getElementById('uploadFile');
    if (!fileInput.files[0]) {
        showToast(pt('uploadSelectFile'), 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const response = await apiCall(`/api/sick-notes/${id}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error(pt('uploadFailed'));

        showToast(pt('uploadSuccess'), 'success');
        closeModal();
        navigateToPage('my-sick-notes');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function downloadSickNoteFile(id) {
    try {
        const response = await apiCall(`/api/sick-notes/${id}/file`);
        if (!response.ok) throw new Error(pt('fileNotFound'));

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        showToast(pt('downloadError') + ': ' + error.message, 'error');
    }
}

async function previewSickNoteFile(event, id, fileName) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    try {
        const response = await apiCall(`/api/sick-notes/${id}/file`);
        if (!response.ok) throw new Error(pt('fileNotFound'));

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        showFileLightbox(url, fileName);

    } catch (error) {
        showToast(pt('fileLoadError') + ': ' + error.message, 'error');
    }

    return false;
}

async function deleteSickNote(id) {
    if (!confirm(pt('sickNoteDeleteConfirm'))) return;

    try {
        const response = await apiCall(`/api/sick-notes/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(pt('deleteFailed'));

        showToast(pt('sickNoteDeleted'), 'success');
        navigateToPage('my-sick-notes');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================
// MY REQUESTS
// ============================================

let _myRequestsCache = [];

async function renderMyRequests(container) {
    const response = await apiCall(`/api/tickets?createdById=${portalUser.id}`);
    _myRequestsCache = (await response.json()).data || [];

    const years = [...new Set(_myRequestsCache.map(t => new Date(t.created_at).getFullYear()))].sort((a, b) => b - a);
    const types = [...new Set(_myRequestsCache.map(t => t.ticket_type))];
    const lang = localStorage.getItem('etilog_portal_lang') || 'sk';

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('myRequestsTitle')}</h1><p>${pt('myRequestsDesc')}</p></div>
            <button class="btn btn-primary" onclick="openNewRequestModal()">${pt('newRequest')}</button>
        </div>
        <div class="page-body">
            <div class="filters-bar">
                <input type="text" class="form-input filter-search" id="myReqSearch" placeholder="${pt('filterSearch')}" oninput="applyMyRequestsFilter()">
                <select class="form-select" id="myReqStatusFilter" onchange="applyMyRequestsFilter()">
                    <option value="">${pt('filterAllStatuses')}</option>
                    <option value="Pending">${pt('filterPending')}</option>
                    <option value="Approved">${pt('filterApproved')}</option>
                    <option value="Rejected">${pt('filterRejected')}</option>
                    <option value="Cancelled">${pt('statusCancelled')}</option>
                </select>
                <select class="form-select" id="myReqTypeFilter" onchange="applyMyRequestsFilter()">
                    <option value="">${pt('filterAllTypes')}</option>
                    ${types.map(t => `<option value="${t}">${translateType(t)}</option>`).join('')}
                </select>
                <select class="form-select" id="myReqYearFilter" onchange="applyMyRequestsFilter()">
                    <option value="">${pt('filterAllYears')}</option>
                    ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
                </select>
            </div>
            <div id="myRequestsList">
                ${renderTicketsTable(_myRequestsCache)}
            </div>
        </div>
    `;
}

function applyMyRequestsFilter() {
    const search = (document.getElementById('myReqSearch')?.value || '').toLowerCase();
    const status = document.getElementById('myReqStatusFilter')?.value || '';
    const type = document.getElementById('myReqTypeFilter')?.value || '';
    const year = document.getElementById('myReqYearFilter')?.value || '';

    let filtered = _myRequestsCache;
    if (status) filtered = filtered.filter(t => t.status === status);
    if (type) filtered = filtered.filter(t => t.ticket_type === type);
    if (year) filtered = filtered.filter(t => new Date(t.created_at).getFullYear() === parseInt(year));
    if (search) filtered = filtered.filter(t =>
        (t.title || '').toLowerCase().includes(search) ||
        (t.description || '').toLowerCase().includes(search) ||
        (t.ticket_id || '').toLowerCase().includes(search) ||
        (t.assigned_approver_name || '').toLowerCase().includes(search)
    );

    document.getElementById('myRequestsList').innerHTML = renderTicketsTable(filtered);
}

// Open new request modal
async function openNewRequestModal() {
    // Load ticket types, users, and quota for the form
    let users = [];
    let quota = null;
    window._loadedTicketTypes = [];
    try {
        const [typesRes, usersRes, quotaRes] = await Promise.all([
            apiCall('/api/ticket-types/active'),
            apiCall('/api/admin/employees'),
            apiCall('/api/quotas/me')
        ]);
        window._loadedTicketTypes = (await typesRes.json()).data || [];
        users = (await usersRes.json()).data || [];
        quota = (await quotaRes.json()).data;
    } catch (e) {
        console.error('Error loading form data:', e);
    }

    window._currentQuota = quota;
    const ticketTypes = window._loadedTicketTypes;
    const lang = localStorage.getItem('etilog_portal_lang') || 'sk';
    const typeOptions = ticketTypes.map(t => {
        const label = lang === 'sk' ? (t.label_sk || t.key) : (t.label_en || t.key);
        return `<option value="${t.key}">${escapeHtml(label)}</option>`;
    }).join('');

    const approverOptions = users
        .filter(u => u.id !== portalUser.id)
        .map(u => `<option value='${JSON.stringify({id: u.id, name: u.name, email: u.email}).replace(/'/g, "&#39;")}'>${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`)
        .join('');

    document.getElementById('modalTitle').textContent = pt('newRequestTitle');
    document.getElementById('modalBody').innerHTML = `
        <form id="newRequestForm">
            <div class="form-group">
                <label class="form-label">${pt('reqFieldTitle')}</label>
                <input type="text" class="form-input" name="title" required placeholder="${pt('reqFieldTitlePlaceholder')}">
            </div>
            <div class="form-group">
                <label class="form-label">${pt('reqFieldDescription')}</label>
                <textarea class="form-input" name="description" required rows="3" placeholder="${pt('reqFieldDescPlaceholder')}"></textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('reqFieldType')}</label>
                    <select class="form-select" name="ticket_type" required onchange="toggleRequestDates(this.value)">
                        <option value="">${pt('reqFieldSelectType')}</option>
                        ${typeOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('reqFieldPriority')}</label>
                    <select class="form-select" name="priority" required>
                        <option value="">${pt('reqFieldSelectPriority')}</option>
                        <option value="Low">${pt('reqPriorityLow')}</option>
                        <option value="Medium" selected>${pt('reqPriorityMedium')}</option>
                        <option value="High">${pt('reqPriorityHigh')}</option>
                        <option value="Urgent">${pt('reqPriorityUrgent')}</option>
                    </select>
                </div>
            </div>
            <div class="form-row" id="requestDatesRow" style="display:none;">
                <div class="form-group">
                    <label class="form-label">${pt('reqFieldStartDate')}</label>
                    <input type="date" class="form-input" name="start_date" onchange="updateWorkingDaysInfo()">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('reqFieldEndDate')}</label>
                    <input type="date" class="form-input" name="end_date" onchange="updateWorkingDaysInfo()">
                </div>
            </div>
            <div id="vacationQuotaInfoBox" class="quota-info-box" style="display:none; background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <span style="font-weight: 600; color: #065f46;">${pt('vacationRemaining')}:</span>
                        <span id="quotaRemainingValue" style="font-weight: 700; color: #065f46;">${quota ? quota.vacation_days_remaining : '-'} ${pt('days')}</span>
                    </div>
                    <div id="selectedDaysInfo" style="display: none;">
                        <span style="font-weight: 600; color: #065f46;">${pt('selectedDays')}:</span>
                        <span id="selectedDaysValue" style="font-weight: 700; color: #065f46;">0 ${pt('days')}</span>
                    </div>
                </div>
                <div id="quotaWarning" style="display: none; margin-top: 8px; padding: 8px; background: #fef3c7; border-radius: 4px; color: #92400e; font-size: 13px;">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${pt('reqFieldApprover')}</label>
                <select class="form-select" name="approver" required>
                    <option value="">${pt('reqFieldSelectApprover')}</option>
                    ${approverOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${pt('attachmentsOptional')}</label>
                <input type="file" class="form-input" name="attachments" multiple accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx">
                <p class="helper-text">${pt('attachmentsHelper')}</p>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitNewRequest()">${pt('save')}</button>
    `;
    openModal();
}

// Toggle date fields based on ticket type
function toggleRequestDates(type) {
    const row = document.getElementById('requestDatesRow');
    const quotaBox = document.getElementById('vacationQuotaInfoBox');
    if (row) {
        const types = window._loadedTicketTypes || [];
        const matched = types.find(t => t.key === type);
        const showDates = matched ? matched.requires_dates : false;
        row.style.display = showDates ? 'grid' : 'none';

        // Show quota info box only for vacation type
        if (quotaBox) {
            const isVacation = type === 'vacation';
            quotaBox.style.display = (showDates && isVacation) ? 'block' : 'none';
            // Reset selected days info when type changes
            const selectedDaysInfo = document.getElementById('selectedDaysInfo');
            if (selectedDaysInfo) selectedDaysInfo.style.display = 'none';
        }
    }
}

// Update working days info when dates change
async function updateWorkingDaysInfo() {
    const form = document.getElementById('newRequestForm');
    if (!form) return;

    const startDate = form.start_date?.value;
    const endDate = form.end_date?.value;
    const ticketType = form.ticket_type?.value;

    const selectedDaysInfo = document.getElementById('selectedDaysInfo');
    const selectedDaysValue = document.getElementById('selectedDaysValue');
    const quotaWarning = document.getElementById('quotaWarning');

    // Only show for vacation type with both dates
    if (ticketType !== 'vacation' || !startDate || !endDate) {
        if (selectedDaysInfo) selectedDaysInfo.style.display = 'none';
        if (quotaWarning) quotaWarning.style.display = 'none';
        return;
    }

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
        if (selectedDaysInfo) selectedDaysInfo.style.display = 'none';
        if (quotaWarning) {
            quotaWarning.style.display = 'block';
            quotaWarning.textContent = pt('dateRangeError');
        }
        return;
    }

    try {
        const response = await apiCall(`/api/quotas/working-days?start_date=${startDate}&end_date=${endDate}`);
        const result = await response.json();

        if (result.success && result.data) {
            const workingDays = result.data.working_days;
            const quota = window._currentQuota;
            const remaining = quota ? quota.vacation_days_remaining : 0;

            if (selectedDaysInfo) selectedDaysInfo.style.display = 'block';
            if (selectedDaysValue) selectedDaysValue.textContent = `${workingDays} ${pt('days')}`;

            // Show warning if not enough days
            if (quotaWarning) {
                if (workingDays > remaining) {
                    quotaWarning.style.display = 'block';
                    quotaWarning.innerHTML = `<strong>&#9888;</strong> ${pt('notEnoughDaysWarning').replace('{selected}', workingDays).replace('{remaining}', remaining)}`;
                } else {
                    quotaWarning.style.display = 'none';
                }
            }
        }
    } catch (e) {
        console.error('Error fetching working days:', e);
    }
}

// Submit new request
async function submitNewRequest() {
    const form = document.getElementById('newRequestForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    try {
        const approverData = JSON.parse(form.approver.value);
        const data = new FormData();
        data.append('title', form.title.value);
        data.append('description', form.description.value);
        data.append('ticket_type', form.ticket_type.value);
        data.append('priority', form.priority.value);
        data.append('created_by_id', portalUser.id);
        data.append('created_by_name', portalUser.name || portalUser.email);
        data.append('created_by_email', portalUser.email);
        data.append('assigned_approver_id', approverData.id);
        data.append('assigned_approver_name', approverData.name);
        data.append('assigned_approver_email', approverData.email);
        data.append('start_date', form.start_date?.value || '');
        data.append('end_date', form.end_date?.value || '');

        const attachments = form.attachments?.files || [];
        Array.from(attachments).forEach(file => {
            if (file && file.size) {
                data.append('attachments', file);
            }
        });

        const response = await apiCall('/api/tickets', {
            method: 'POST',
            body: data
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || pt('reqCreateError'));
        }

        closeModal();
        showToast(pt('reqCreated'), 'success');
        navigateToPage('my-requests');
    } catch (error) {
        showToast(error.message || pt('reqCreateError'), 'error');
    }
}

// ============================================
// MY APPROVALS
// ============================================

let _pendingApprovalsCache = [];
let _approvalHistoryCache = [];
let _currentApprovalTab = 'pending';

async function renderMyApprovals(container) {
    // Fetch both pending tickets assigned to me AND my approval history
    const [pendingRes, historyRes] = await Promise.all([
        apiCall(`/api/tickets?assignedApproverId=${portalUser.id}&status=Pending`),
        apiCall('/api/tickets/approvals/me')
    ]);
    _pendingApprovalsCache = (await pendingRes.json()).data || [];
    _approvalHistoryCache = (await historyRes.json()).data || [];

    const pendingCount = _pendingApprovalsCache.length;

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('myApprovalsTitle')}</h1><p>${pt('myApprovalsDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="portal-tabs">
                <button class="portal-tab active" onclick="switchApprovalTab('pending', this)">
                    ${pt('tabPendingApprovals')}
                    ${pendingCount > 0 ? `<span class="tab-count pending-count">${pendingCount}</span>` : ''}
                </button>
                <button class="portal-tab" onclick="switchApprovalTab('history', this)">
                    ${pt('tabApprovalHistory')}
                </button>
            </div>
            <div id="approvalTabContent">
                ${renderPendingApprovals(_pendingApprovalsCache)}
            </div>
        </div>

        <!-- Reject Modal -->
        <div class="reject-modal-overlay" id="portalRejectOverlay" onclick="if(event.target===this)closePortalRejectModal()">
            <div class="reject-modal">
                <h3>${pt('rejectModalTitle')}</h3>
                <textarea id="portalRejectReason" placeholder="${pt('rejectModalPlaceholder')}"></textarea>
                <div class="reject-modal-actions">
                    <button class="btn btn-secondary" onclick="closePortalRejectModal()">${pt('cancel')}</button>
                    <button class="btn-reject" onclick="submitPortalReject()">${pt('rejectModalSubmit')}</button>
                </div>
            </div>
        </div>
    `;
    _currentApprovalTab = 'pending';
}

function switchApprovalTab(tab, btn) {
    _currentApprovalTab = tab;
    document.querySelectorAll('.portal-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const content = document.getElementById('approvalTabContent');
    if (tab === 'pending') {
        content.innerHTML = renderPendingApprovals(_pendingApprovalsCache);
    } else {
        content.innerHTML = renderApprovalHistory(_approvalHistoryCache);
    }
}

function renderPendingApprovals(tickets) {
    if (!tickets.length) {
        return `<div class="empty-state"><div class="empty-icon">&#9989;</div><div class="empty-text">${pt('noPendingApprovals')}</div></div>`;
    }
    return tickets.map(t => {
        const priorityColors = { 'Low': '#6b7280', 'Medium': '#2563eb', 'High': '#f59e0b', 'Urgent': '#ef4444' };
        const priorityColor = priorityColors[t.priority] || '#6b7280';
        return `
            <div class="approval-card">
                <div class="approval-card-header">
                    <div>
                        <div class="approval-card-title">${escapeHtml(t.title)}</div>
                        <small style="color:var(--gray-400)">${t.ticket_id}</small>
                    </div>
                    <span class="badge badge-${{'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[t.ticket_type] || 'user'}">${translateType(t.ticket_type)}</span>
                </div>
                <div class="approval-card-meta">
                    <span><strong>${pt('colCreatedBy')}:</strong> ${escapeHtml(t.created_by_name || '')}</span>
                    <span><strong>${pt('colPriority')}:</strong> <span style="color:${priorityColor};font-weight:600">${t.priority}</span></span>
                    <span><strong>${pt('colDate')}:</strong> ${formatDate(t.created_at)}</span>
                    ${t.start_date && t.end_date ? `<span><strong>${pt('colDates')}:</strong> ${formatDate(t.start_date)} &rarr; ${formatDate(t.end_date)}</span>` : ''}
                </div>
                ${t.description ? `<div class="approval-card-desc">${escapeHtml(t.description)}</div>` : ''}
                <div class="approval-card-actions">
                    ${t.attachment_count > 0 ? `<button class="btn btn-ghost btn-sm" onclick="openTicketAttachments('${t.ticket_id}', '${escapeHtml(t.title)}')">&#128206; ${pt('colAttachments')} (${t.attachment_count})</button>` : ''}
                    <button class="btn-reject" onclick="openPortalRejectModal('${t.ticket_id}')">&#10005; ${pt('btnReject')}</button>
                    <button class="btn-approve" onclick="portalApproveTicket('${t.ticket_id}')">&#10003; ${pt('btnApprove')}</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderApprovalHistory(approvals) {
    if (!approvals.length) {
        return `<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">${pt('noApprovalHistory')}</div></div>`;
    }
    return `
        <div class="portal-card">
            <div class="card-body" style="overflow-x:auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>${pt('colName')}</th>
                            <th>${pt('colType')}</th>
                            <th>${pt('colCreatedBy')}</th>
                            <th>${pt('colDecision')}</th>
                            <th>${pt('colDecisionDate')}</th>
                            <th>${pt('colAttachments')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${approvals.map(a => `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(a.title)}</strong>
                                    ${a.action_rejection_reason ? `<br><small style="color:var(--red-500)">${pt('reason')}: ${escapeHtml(a.action_rejection_reason)}</small>` : ''}
                                </td>
                                <td><span class="badge badge-${{'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[a.ticket_type] || 'user'}">${translateType(a.ticket_type)}</span></td>
                                <td>${escapeHtml(a.created_by_name || '-')}</td>
                                <td><span class="badge badge-${a.action.toLowerCase()}">${translateStatus(a.action)}</span></td>
                                <td>${formatDate(a.action_timestamp)}</td>
                                <td>
                                    ${a.attachment_count > 0 ? `<button class="btn btn-ghost btn-sm" onclick="openTicketAttachments('${a.ticket_id}', '${escapeHtml(a.title)}')">&#128206; ${pt('attachments')} (${a.attachment_count})</button>` : '<span style="color:var(--gray-300)">—</span>'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Portal approve ticket
async function portalApproveTicket(ticketId) {
    if (!confirm(pt('approveConfirm'))) return;
    try {
        const response = await apiCall(`/api/tickets/${ticketId}/approve`, { method: 'POST' });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.message || pt('approveFailed'));
        }
        showToast(pt('approveSuccess'), 'success');
        navigateToPage('my-approvals');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Portal reject modal
let _pendingRejectTicketId = null;

function openPortalRejectModal(ticketId) {
    _pendingRejectTicketId = ticketId;
    document.getElementById('portalRejectOverlay').classList.add('active');
    const textarea = document.getElementById('portalRejectReason');
    textarea.value = '';
    textarea.focus();
}

function closePortalRejectModal() {
    document.getElementById('portalRejectOverlay').classList.remove('active');
    _pendingRejectTicketId = null;
}

async function submitPortalReject() {
    const reason = document.getElementById('portalRejectReason').value.trim();
    if (!reason) {
        showToast(pt('rejectReasonRequired'), 'error');
        return;
    }
    try {
        const response = await apiCall(`/api/tickets/${_pendingRejectTicketId}/reject`, {
            method: 'POST',
            body: JSON.stringify({ rejectionReason: reason })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.message || pt('rejectFailed'));
        }
        closePortalRejectModal();
        showToast(pt('rejectSuccess'), 'success');
        navigateToPage('my-approvals');
    } catch (error) {
        closePortalRejectModal();
        showToast(error.message, 'error');
    }
}

// ============================================
// ADMIN DASHBOARD
// ============================================

async function renderAdminDashboard(container) {
    const year = new Date().getFullYear();
    const response = await apiCall(`/api/admin/stats?year=${year}`);
    const stats = (await response.json()).data;

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('adminDashboardTitle')}</h1><p>${pt('adminDashboardDesc')} ${year}</p></div>
        </div>
        <div class="page-body">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">&#128101;</div>
                    <div><div class="stat-value">${stats.totalUsers}</div><div class="stat-label">${pt('totalEmployees')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon amber">&#9203;</div>
                    <div><div class="stat-value">${stats.tickets.pending}</div><div class="stat-label">${pt('pendingTickets')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">&#9989;</div>
                    <div><div class="stat-value">${stats.tickets.approved}</div><div class="stat-label">${pt('approvedTickets')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">&#10060;</div>
                    <div><div class="stat-value">${stats.tickets.rejected}</div><div class="stat-label">${pt('rejectedTickets')}</div></div>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon green">&#127796;</div>
                    <div><div class="stat-value">${stats.tickets.approved_vacations}</div><div class="stat-label">${pt('approvedVacations')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon amber">&#129298;</div>
                    <div><div class="stat-value">${stats.tickets.approved_sick_leaves}</div><div class="stat-label">${pt('approvedSickLeaves')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon blue">&#128203;</div>
                    <div><div class="stat-value">${stats.sickNotes.total_sick_notes}</div><div class="stat-label">${pt('totalSickNotes')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">&#128196;</div>
                    <div><div class="stat-value">${stats.tickets.total}</div><div class="stat-label">${pt('totalTickets')}</div></div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// ADMIN EMPLOYEES
// ============================================

async function renderAdminEmployees(container) {
    const year = new Date().getFullYear();
    const [employeesRes, allUsersRes] = await Promise.all([
        apiCall(`/api/admin/employees?year=${year}`),
        apiCall('/api/admin/all-azure-users')
    ]);
    const employees = (await employeesRes.json()).data || [];
    const allUsersData = await allUsersRes.json();
    const unlicensedUsers = allUsersData.unlicensedUsers || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('employeesTitle')}</h1><p>${pt('employeesDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr><th>${pt('colName')}</th><th>${pt('colEmail')}</th><th>${pt('colRole')}</th><th>${pt('colVisibility')}</th><th>${pt('colVacation')}</th><th>${pt('colParagraph')}</th><th>${pt('colOcr')}</th>${portalUser?.role === 'admin' ? `<th>${pt('colActions')}</th>` : ''}</tr>
                        </thead>
                        <tbody>
                            ${employees.map(e => `
                                <tr${e.hidden ? ' style="opacity: 0.5;"' : ''}>
                                    <td><strong>${escapeHtml(e.name)}</strong></td>
                                    <td>${escapeHtml(e.email)}</td>
                                    <td><span class="badge badge-${e.role}">${e.role}</span></td>
                                    <td><span class="badge badge-${e.hidden ? 'hidden' : 'visible'}">${e.hidden ? pt('hiddenLabel') : pt('visibleLabel')}</span></td>
                                    <td>${e.vacation_days_total !== null ? `${e.vacation_days_used}/${e.vacation_days_total}` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                    <td>${e.paragraph_days_total !== null && e.paragraph_days_total !== undefined ? `${e.paragraph_days_used || 0}/${e.paragraph_days_total}` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                    <td>${e.ocr_days_total !== null && e.ocr_days_total !== undefined ? `${e.ocr_days_used || 0}/${e.ocr_days_total}` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                    ${portalUser?.role === 'admin' ? `<td>
                                        <div class="table-actions">
                                            <button class="btn-icon" onclick="toggleEmployeeVisibility('${e.id}', ${e.hidden})" title="${e.hidden ? pt('showUserTitle') : pt('hideUserTitle')}">${e.hidden ? '&#128065;' : '&#128683;'}</button>
                                            <button class="btn-icon" onclick="openChangeRoleModal('${e.id}', '${e.role}', '${e.name.replace(/'/g, "\\'")}')" title="${pt('changeRoleTitle')}">${e.role === 'admin' ? '&#128081;' : e.role === 'spravca' ? '&#128188;' : e.role === 'sklad' ? '&#128230;' : '&#128100;'}</button>
                                        </div>
                                    </td>` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ${unlicensedUsers.length > 0 ? `
            <div class="portal-card" style="margin-top: 1.5rem; border-left: 4px solid var(--warning);">
                <div class="card-header">
                    <h2 style="color: var(--warning);">${pt('unlicensedUsersTitle') || 'Bez licencie'} (${unlicensedUsers.length})</h2>
                </div>
                <div class="card-body">
                    <p style="color: var(--gray-500); margin-bottom: 1rem;">${pt('unlicensedUsersDesc') || 'Nasledujuci pouzivatelia nemaju pridelenu Microsoft licenciu a preto sa nezobrazuju v zozname zamestnancov. Pre ich zahrnutie im musite pridelit licenciu v Azure AD.'}</p>
                    <table class="data-table">
                        <thead>
                            <tr><th>${pt('colName')}</th><th>${pt('colEmail')}</th></tr>
                        </thead>
                        <tbody>
                            ${unlicensedUsers.map(u => `
                                <tr>
                                    <td><strong>${escapeHtml(u.name)}</strong></td>
                                    <td>${escapeHtml(u.email)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

async function toggleEmployeeVisibility(userId, isHidden) {
    const action = isHidden ? pt('showUserConfirm') : pt('hideUserConfirm');
    if (!confirm(action)) return;

    try {
        const response = await apiCall(`/api/admin/employees/${userId}/visibility`, {
            method: 'PUT'
        });
        if (!response.ok) throw new Error(pt('changeFailed'));
        const result = await response.json();
        showToast(result.data.hidden ? pt('userHidden') : pt('userVisible'), 'success');
        navigateToPage('admin-employees');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function openChangeRoleModal(userId, currentRole, userName) {
    document.getElementById('modalTitle').textContent = pt('changeRoleModalTitle');
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label style="font-weight: 500; margin-bottom: 0.5rem; display: block;">${escapeHtml(userName)}</label>
            <label for="roleSelect">${pt('selectRole')}:</label>
            <select id="roleSelect" class="form-control" style="margin-top: 0.5rem;">
                <option value="user" ${currentRole === 'user' ? 'selected' : ''}>${pt('roleUser')}</option>
                <option value="spravca" ${currentRole === 'spravca' ? 'selected' : ''}>${pt('roleSpravca')}</option>
                <option value="sklad" ${currentRole === 'sklad' ? 'selected' : ''}>${pt('roleSklad')}</option>
                <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>${pt('roleAdmin')}</option>
            </select>
        </div>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitRoleChange('${userId}')">${pt('saveRole')}</button>
    `;
    openModal();
}

async function submitRoleChange(userId) {
    const newRole = document.getElementById('roleSelect').value;

    try {
        const response = await apiCall(`/api/admin/employees/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: newRole })
        });
        if (!response.ok) throw new Error(pt('changeFailed'));
        showToast(`${pt('roleChanged')} ${newRole}`, 'success');
        closeModal();
        navigateToPage('admin-employees');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================
// ADMIN QUOTAS
// ============================================

async function renderAdminQuotas(container) {
    const year = new Date().getFullYear();

    // Auto-sync: synchronize employees and create quotas for new users (does NOT modify existing quotas)
    try {
        await apiCall('/api/quotas/initialize', {
            method: 'POST',
            body: JSON.stringify({ year })
        });
    } catch (e) {
        console.warn('Auto-sync failed:', e);
    }

    const quotasRes = await apiCall(`/api/quotas/all?year=${year}`);
    const quotas = (await quotasRes.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('adminQuotasTitle')}</h1><p>${pt('adminQuotasDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-header">
                    <h2>${pt('employeeQuotasYear')} ${year}</h2>
                </div>
                <div class="card-body scrollable-table-container">
                    <table class="data-table sticky-header">
                        <thead>
                            <tr><th>${pt('colEmployee')}</th><th>${pt('colVacTotal')}</th><th>${pt('colVacUsed')}</th><th>${pt('colBalance')}</th><th>${pt('colParagraphTotal')}</th><th>${pt('colParagraphUsed')}</th><th>${pt('colBalance')}</th><th>${pt('colOcrTotal')}</th><th>${pt('colOcrUsed')}</th><th>${pt('colBalance')}</th><th>${pt('colActions')}</th></tr>
                        </thead>
                        <tbody>
                            ${quotas.map(q => `
                                <tr>
                                    <td><strong>${escapeHtml(q.display_name || 'N/A')}</strong><br><small style="color:var(--gray-500)">${escapeHtml(q.email || '')}</small></td>
                                    <td>${q.vacation_days_total}</td>
                                    <td>${q.vacation_days_used}</td>
                                    <td><strong style="color:${q.vacation_days_remaining <= 2 ? 'var(--red-500)' : 'var(--green-600)'}">${q.vacation_days_remaining}</strong></td>
                                    <td>${q.paragraph_days_total || 7}</td>
                                    <td>${Number(q.paragraph_days_used || 0).toFixed(2)}</td>
                                    <td><strong style="color:${q.paragraph_days_remaining <= 1 ? 'var(--red-500)' : 'var(--green-600)'}">${Number(q.paragraph_days_remaining).toFixed(2)}</strong></td>
                                    <td>${q.ocr_days_total || 7}</td>
                                    <td>${Number(q.ocr_days_used || 0).toFixed(2)}</td>
                                    <td><strong style="color:${q.ocr_days_remaining <= 1 ? 'var(--red-500)' : 'var(--green-600)'}">${Number(q.ocr_days_remaining).toFixed(2)}</strong></td>
                                    <td><button class="btn-icon primary" onclick="editUserQuotas('${q.user_id}', '${escapeHtml(q.display_name || '')}', ${q.vacation_days_total}, ${q.vacation_days_remaining}, ${q.paragraph_days_total || 7}, ${q.paragraph_days_remaining}, ${q.ocr_days_total || 7}, ${q.ocr_days_remaining})" title="${pt('editQuota')}">&#9999;</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

// Edit individual user quotas
async function editUserQuotas(userId, userName, vacTotal, vacRemaining, paragraphTotal, paragraphRemaining, ocrTotal, ocrRemaining) {
    const year = new Date().getFullYear();
    document.getElementById('modalTitle').textContent = `${pt('editQuota')} - ${userName}`;
    document.getElementById('modalBody').innerHTML = `
        <form id="userQuotaForm">
            <div class="form-group">
                <label class="form-label" style="font-weight:600;margin-bottom:8px;">${pt('quotaFieldVacation')}</label>
                <div class="form-group">
                    <label class="form-label">${pt('quotaZostatok')}</label>
                    <input type="number" class="form-input" name="vacation_days_remaining" value="${vacRemaining}" min="0" max="100" step="0.5">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-weight:600;margin-bottom:8px;">${pt('quotaFieldParagraph')}</label>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">${pt('quotaNarok')}</label>
                        <input type="number" class="form-input" name="paragraph_days_total" value="${paragraphTotal}" min="0" max="30" step="0.01">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${pt('quotaZostatok')}</label>
                        <input type="number" class="form-input" name="paragraph_days_remaining" value="${paragraphRemaining}" min="0" max="30" step="0.01">
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-weight:600;margin-bottom:8px;">${pt('quotaFieldOcr')}</label>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">${pt('quotaNarok')}</label>
                        <input type="number" class="form-input" name="ocr_days_total" value="${ocrTotal}" min="0" max="30" step="0.01">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${pt('quotaZostatok')}</label>
                        <input type="number" class="form-input" name="ocr_days_remaining" value="${ocrRemaining}" min="0" max="30" step="0.01">
                    </div>
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="saveUserQuotas('${userId}', ${year})">${pt('save')}</button>
    `;
    openModal();
}

async function saveUserQuotas(userId, year) {
    const form = document.getElementById('userQuotaForm');

    const vacRemaining = parseFloat(form.vacation_days_remaining.value);
    const paragraphTotal = parseFloat(form.paragraph_days_total.value);
    const paragraphRemaining = parseFloat(form.paragraph_days_remaining.value);
    const ocrTotal = parseFloat(form.ocr_days_total.value);
    const ocrRemaining = parseFloat(form.ocr_days_remaining.value);

    // Vacation: only remaining is stored (no total/used)
    // Paragraph & OCR: calculate used from total - remaining
    const data = {
        year,
        vacation_days_remaining: vacRemaining,
        paragraph_days_total: paragraphTotal,
        paragraph_days_used: paragraphTotal - paragraphRemaining,
        ocr_days_total: ocrTotal,
        ocr_days_used: ocrTotal - ocrRemaining
    };

    try {
        const response = await apiCall(`/api/quotas/user/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(pt('saveFailed'));
        showToast(pt('quotaSaved'), 'success');
        closeModal();
        navigateToPage('admin-quotas');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================
// ADMIN SICK NOTES
// ============================================

async function renderAdminSickNotes(container) {
    const year = new Date().getFullYear();
    const notesRes = await apiCall(`/api/sick-notes/all?year=${year}`);
    const notes = (await notesRes.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('allSickNotesTitle')}</h1><p>${pt('allSickNotesDesc')}</p></div>
        </div>
        <div class="page-body">
            ${portalUser?.role === 'admin' ? `<div class="filters-bar" style="margin-bottom: 15px;">
                <button class="btn btn-danger" id="bulkDeleteSickNotesBtn" style="display:none;" onclick="bulkDeleteSickNotes()">
                    <span style="margin-right:5px;">&#128465;</span> ${pt('bulkDelete')} (<span id="selectedSickNotesCount">0</span>)
                </button>
            </div>` : ''}
            <div id="adminSickNotesList" class="portal-card">
                <div class="card-header">
                    <h3>${pt('documentsSection')}</h3>
                </div>
                <div class="card-body" style="overflow-x:auto;">
                    ${renderAdminSickNotesTable(notes)}
                </div>
            </div>
        </div>
    `;

    window._adminSickNotes = notes;
}

function renderAdminSickNotesTable(notes) {
    if (!notes.length) return `<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">${pt('noSickNotes')}</div></div>`;
    const isAdmin = portalUser?.role === 'admin';
    return `
        <table class="data-table">
            <thead>
                <tr>
                    ${isAdmin ? `<th style="width:40px;"><input type="checkbox" id="selectAllSickNotes" onchange="toggleAllSickNotes(this)"></th>` : ''}
                    <th>${pt('colEmployeeName')}</th><th>${pt('colDocType')}</th><th>${pt('colName')}</th><th>${pt('colDate')}</th><th>${pt('sickNoteColDoctor')}</th><th>${pt('colDocument')}</th>
                </tr>
            </thead>
            <tbody>
                ${notes.map(n => {
                    const docLabel = n.document_type === 'ocr' ? (pt('sickNoteDocTypeOcr') || 'OČR') : (pt('sickNoteDocTypeParagraph') || 'Paragraf');
                    const docBadge = n.document_type === 'ocr' ? 'badge-sick' : 'badge-paragraph';
                    return `
                    <tr>
                        ${isAdmin ? `<td><input type="checkbox" class="sick-note-checkbox" value="${n.id}" onchange="updateBulkDeleteSickNotesBtn()"></td>` : ''}
                        <td><strong>${escapeHtml(n.user_name)}</strong><br><small style="color:var(--gray-500)">${escapeHtml(n.user_email)}</small></td>
                        <td><span class="badge ${docBadge}">${docLabel}</span></td>
                        <td><strong>${escapeHtml(n.title)}</strong>${n.diagnosis ? `<br><small style="color:var(--gray-500)">${escapeHtml(n.diagnosis)}</small>` : ''}</td>
                        <td>${formatDate(n.start_date)}${n.end_date && n.end_date !== n.start_date ? ` - ${formatDate(n.end_date)}` : ''}</td>
                        <td>${n.doctor_name ? escapeHtml(n.doctor_name) : '<span style="color:var(--gray-300)">—</span>'}</td>
                        <td>${n.file_name ? `<button class="btn-file-link" onclick="return previewSickNoteFile(event, ${n.id}, '${escapeHtml(n.file_name)}')">&#128065; ${escapeHtml(n.file_name)}</button>` : '<span style="color:var(--gray-300)">—</span>'}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

function toggleAllSickNotes(checkbox) {
    const checkboxes = document.querySelectorAll('.sick-note-checkbox');
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    updateBulkDeleteSickNotesBtn();
}

function updateBulkDeleteSickNotesBtn() {
    const checked = document.querySelectorAll('.sick-note-checkbox:checked');
    const btn = document.getElementById('bulkDeleteSickNotesBtn');
    const count = document.getElementById('selectedSickNotesCount');
    if (checked.length > 0) {
        btn.style.display = 'inline-flex';
        count.textContent = checked.length;
    } else {
        btn.style.display = 'none';
    }
    // Update select all checkbox state
    const allCheckboxes = document.querySelectorAll('.sick-note-checkbox');
    const selectAll = document.getElementById('selectAllSickNotes');
    if (selectAll) {
        selectAll.checked = allCheckboxes.length > 0 && checked.length === allCheckboxes.length;
        selectAll.indeterminate = checked.length > 0 && checked.length < allCheckboxes.length;
    }
}

async function bulkDeleteSickNotes() {
    const checked = document.querySelectorAll('.sick-note-checkbox:checked');
    const sickNoteIds = Array.from(checked).map(cb => parseInt(cb.value));

    if (sickNoteIds.length === 0) return;

    if (!confirm(pt('confirmBulkDeleteSickNotes').replace('{count}', sickNoteIds.length))) return;

    try {
        const response = await apiCall('/api/admin/data/sick-notes/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ sickNoteIds })
        });
        const data = await response.json();

        if (data.success) {
            showToast(pt('bulkDeleteSickNotesSuccess').replace('{count}', data.count), 'success');
            // Reload the page to show fresh data
            await refreshAdminSickNotes();
        } else {
            showToast(data.message || pt('bulkDeleteSickNotesError'), 'error');
        }
    } catch (error) {
        console.error('Bulk delete sick notes error:', error);
        showToast(pt('bulkDeleteSickNotesError'), 'error');
    }
}

async function refreshAdminSickNotes() {
    const year = new Date().getFullYear();
    const notesRes = await apiCall(`/api/sick-notes/all?year=${year}`);
    const notes = (await notesRes.json()).data || [];
    window._adminSickNotes = notes;
    const cardBody = document.querySelector('#adminSickNotesList .card-body');
    if (cardBody) {
        cardBody.innerHTML = renderAdminSickNotesTable(notes);
    }
    updateBulkDeleteSickNotesBtn();
}


// ============================================
// ADMIN ALL TICKETS
// ============================================

async function renderAdminTickets(container) {
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear - 2];

    // Load tickets and employees in parallel
    const [ticketsResponse, employeesResponse] = await Promise.all([
        apiCall(`/api/admin/tickets?year=${currentYear}`),
        apiCall('/api/admin/employees')
    ]);
    const tickets = (await ticketsResponse.json()).data || [];
    const employees = (await employeesResponse.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('allTicketsTitle')}</h1><p>${pt('allTicketsDesc')}</p></div>
            <div class="page-header-actions">
                <button class="btn btn-primary" onclick="openExportModal()">
                    <span style="margin-right:5px;">&#128190;</span> ${pt('exportBtn')}
                </button>
            </div>
        </div>
        <div class="page-body">
            <div class="filters-bar" style="flex-wrap: wrap;">
                <select class="form-select" id="adminTicketYear" onchange="loadAdminTicketsByYear()">
                    ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
                </select>
                <select class="form-select" id="adminTicketEmployee" onchange="filterAdminTickets()">
                    <option value="">${pt('filterAllEmployees')}</option>
                    ${employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
                </select>
                <select class="form-select" id="adminTicketStatus" onchange="filterAdminTickets()">
                    <option value="">${pt('filterAllStatuses')}</option>
                    <option value="Pending">${pt('filterPending')}</option>
                    <option value="Approved">${pt('filterApproved')}</option>
                    <option value="Rejected">${pt('filterRejected')}</option>
                </select>
                <select class="form-select" id="adminTicketType" onchange="filterAdminTickets()">
                    <option value="">${pt('filterAllTypes')}</option>
                    <option value="vacation">${pt('filterVacation')}</option>
${portalUser?.role === 'admin' ? `                    <option value="sick-leave">${pt('filterSickLeave')}</option>` : ''}
                    <option value="paragraph">${pt('filterParagraph')}</option>
                    <option value="ocr">${pt('filterOcr')}</option>
${portalUser?.role === 'admin' ? `                    <option value="purchase">${pt('filterPurchase')}</option>
                    <option value="expense">${pt('filterExpense')}</option>
                    <option value="hr">${pt('filterHr')}</option>
                    <option value="other">${pt('filterOther')}</option>` : ''}
                </select>
                <div class="filter-date-group">
                    <label>${pt('filterDateFrom')}:</label>
                    <input type="date" class="form-input" id="adminTicketDateFrom" onchange="filterAdminTickets()">
                </div>
                <div class="filter-date-group">
                    <label>${pt('filterDateTo')}:</label>
                    <input type="date" class="form-input" id="adminTicketDateTo" onchange="filterAdminTickets()">
                </div>
                <button class="btn btn-secondary btn-sm" onclick="clearAdminTicketFilters()" title="${pt('clearFilters')}">
                    <span>&#10006;</span> ${pt('clearFilters')}
                </button>
${portalUser?.role === 'admin' ? `<button class="btn btn-danger" id="bulkDeleteBtn" style="display:none;" onclick="bulkDeleteTickets()">
                    <span style="margin-right:5px;">&#128465;</span> ${pt('bulkDelete')} (<span id="selectedCount">0</span>)
                </button>` : ''}
            </div>
            <div class="filter-summary" id="filterSummary" style="display:none;"></div>
            <div id="adminTicketsList" class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    ${renderAdminTicketsTable(tickets)}
                </div>
            </div>
        </div>
    `;

    window._adminTickets = tickets;
    window._adminEmployees = employees;

    // For spravca role, filter and re-render with only allowed ticket types
    if (portalUser?.role === 'spravca') {
        filterAdminTickets();
    }
}

async function loadAdminTicketsByYear() {
    const year = document.getElementById('adminTicketYear').value;
    const response = await apiCall(`/api/admin/tickets?year=${year}`);
    const tickets = (await response.json()).data || [];
    window._adminTickets = tickets;
    filterAdminTickets();
}

function clearAdminTicketFilters() {
    document.getElementById('adminTicketEmployee').value = '';
    document.getElementById('adminTicketStatus').value = '';
    document.getElementById('adminTicketType').value = '';
    document.getElementById('adminTicketDateFrom').value = '';
    document.getElementById('adminTicketDateTo').value = '';
    filterAdminTickets();
}

function filterAdminTickets() {
    const employee = document.getElementById('adminTicketEmployee')?.value || '';
    const status = document.getElementById('adminTicketStatus')?.value || '';
    const type = document.getElementById('adminTicketType')?.value || '';
    const dateFrom = document.getElementById('adminTicketDateFrom')?.value || '';
    const dateTo = document.getElementById('adminTicketDateTo')?.value || '';

    let filtered = window._adminTickets || [];

    // For spravca role, only show vacation, ocr, paragraph tickets
    if (portalUser?.role === 'spravca') {
        const allowedTypes = ['vacation', 'ocr', 'paragraph'];
        filtered = filtered.filter(t => allowedTypes.includes(t.ticket_type));
    }

    if (employee) {
        filtered = filtered.filter(t => t.created_by_id === employee);
    }
    if (status) {
        filtered = filtered.filter(t => t.status === status);
    }
    if (type) {
        filtered = filtered.filter(t => t.ticket_type === type);
    }
    if (dateFrom) {
        const fromDate = new Date(dateFrom);
        filtered = filtered.filter(t => {
            const ticketDate = t.start_date ? new Date(t.start_date) : new Date(t.created_at);
            return ticketDate >= fromDate;
        });
    }
    if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(t => {
            const ticketDate = t.end_date ? new Date(t.end_date) : new Date(t.created_at);
            return ticketDate <= toDate;
        });
    }

    // Update filter summary
    updateFilterSummary(filtered.length, (window._adminTickets || []).length, { employee, status, type, dateFrom, dateTo });

    document.querySelector('#adminTicketsList .card-body').innerHTML = renderAdminTicketsTable(filtered);
}

function updateFilterSummary(filteredCount, totalCount, filters) {
    const summaryEl = document.getElementById('filterSummary');
    const hasFilters = filters.employee || filters.status || filters.type || filters.dateFrom || filters.dateTo;

    if (hasFilters && summaryEl) {
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `<span class="filter-info">${pt('filterResults')}: <strong>${filteredCount}</strong> ${pt('of')} ${totalCount} ${pt('tickets')}</span>`;
    } else if (summaryEl) {
        summaryEl.style.display = 'none';
    }
}

function renderAdminTicketsTable(tickets) {
    if (!tickets.length) return `<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">${pt('noTickets')}</div></div>`;
    const isAdmin = portalUser?.role === 'admin';
    return `
        <table class="data-table">
            <thead>
                <tr>
                    ${isAdmin ? `<th style="width:40px;"><input type="checkbox" id="selectAllTickets" onchange="toggleAllTickets(this)"></th>` : ''}
                    <th>${pt('colTicketId')}</th><th>${pt('colName')}</th><th>${pt('colType')}</th><th>${pt('colCreatedBy')}</th><th>${pt('colApprover')}</th><th>${pt('colStatus')}</th><th>${pt('colDate')}</th><th style="width:60px;">${pt('colActions')}</th>
                </tr>
            </thead>
            <tbody>
                ${tickets.map(t => `
                    <tr>
                        ${isAdmin ? `<td><input type="checkbox" class="ticket-checkbox" value="${t.ticket_id}" onchange="updateBulkDeleteBtn()"></td>` : ''}
                        <td><code>${t.ticket_id}</code></td>
                        <td>${escapeHtml(t.title)}</td>
                        <td><span class="badge badge-${{'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[t.ticket_type] || 'user'}">${translateType(t.ticket_type)}</span></td>
                        <td>${escapeHtml(t.created_by_name)}</td>
                        <td>${t.assigned_approver_name ? escapeHtml(t.assigned_approver_name) : '-'}</td>
                        <td><span class="badge badge-${t.status.toLowerCase()}">${translateStatus(t.status)}</span></td>
                        <td>${formatDate(t.created_at)}${t.start_date ? `<br><small>${formatDate(t.start_date)} - ${formatDate(t.end_date)}</small>` : ''}</td>
                        <td style="white-space:nowrap;">
                            <button class="btn btn-sm btn-secondary" onclick="openTicketDetailModal('${t.ticket_id}')" title="${pt('ticketDetailTitle')}">&#128065;</button>
                            ${isAdmin ? `<button class="btn btn-sm btn-primary" onclick="openEditTicketModal('${t.ticket_id}')" title="${pt('editTicketTitle') || 'Upraviť tiket'}" style="margin-left:4px;">&#9999;</button>` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function toggleAllTickets(checkbox) {
    const checkboxes = document.querySelectorAll('.ticket-checkbox');
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    updateBulkDeleteBtn();
}

function updateBulkDeleteBtn() {
    const checked = document.querySelectorAll('.ticket-checkbox:checked');
    const btn = document.getElementById('bulkDeleteBtn');
    const count = document.getElementById('selectedCount');
    if (checked.length > 0) {
        btn.style.display = 'inline-flex';
        count.textContent = checked.length;
    } else {
        btn.style.display = 'none';
    }
    // Update select all checkbox state
    const allCheckboxes = document.querySelectorAll('.ticket-checkbox');
    const selectAll = document.getElementById('selectAllTickets');
    if (selectAll) {
        selectAll.checked = allCheckboxes.length > 0 && checked.length === allCheckboxes.length;
        selectAll.indeterminate = checked.length > 0 && checked.length < allCheckboxes.length;
    }
}

async function bulkDeleteTickets() {
    const checked = document.querySelectorAll('.ticket-checkbox:checked');
    const ticketIds = Array.from(checked).map(cb => cb.value);

    if (ticketIds.length === 0) return;

    if (!confirm(pt('confirmBulkDelete').replace('{count}', ticketIds.length))) return;

    try {
        const response = await apiCall('/api/admin/data/tickets/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ ticketIds })
        });
        const data = await response.json();

        if (data.success) {
            showToast(pt('bulkDeleteSuccess').replace('{count}', data.count), 'success');
            // Reload the page to show fresh data
            await refreshAdminTickets();
        } else {
            showToast(data.message || pt('bulkDeleteError'), 'error');
        }
    } catch (error) {
        console.error('Bulk delete error:', error);
        showToast(pt('bulkDeleteError'), 'error');
    }
}

async function refreshAdminTickets() {
    const year = document.getElementById('adminTicketYear')?.value || new Date().getFullYear();
    const response = await apiCall(`/api/admin/tickets?year=${year}`);
    const tickets = (await response.json()).data || [];
    window._adminTickets = tickets;
    filterAdminTickets();
    updateBulkDeleteBtn();
}

// ============================================
// EXPORT FUNCTIONALITY
// ============================================

function openExportModal() {
    const currentYear = new Date().getFullYear();
    const employees = window._adminEmployees || [];
    const today = new Date().toISOString().split('T')[0];
    const yearStart = `${currentYear}-01-01`;

    const modalHtml = `
        <div class="modal-backdrop" onclick="closeModal(this)">
            <div class="modal modal-lg" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2><span style="margin-right:8px;">&#128190;</span>${pt('exportTitle')}</h2>
                    <button class="modal-close" onclick="closeModal(this.closest('.modal-backdrop'))">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="export-desc">${pt('exportDesc')}</p>
                    <form id="exportForm" onsubmit="handleExport(event)">
                        <div class="form-grid-2">
                            <div class="form-group">
                                <label class="form-label">${pt('exportTicketType')} *</label>
                                <select class="form-select" id="exportType" required>
                                    <option value="vacation">${pt('filterVacation')}</option>
                                    <option value="sick-leave">${pt('filterSickLeave')}</option>
                                    <option value="paragraph">${pt('filterParagraph')}</option>
                                    <option value="ocr">${pt('filterOcr')}</option>
                                    <option value="">${pt('filterAllTypes')}</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">${pt('exportEmployee')}</label>
                                <select class="form-select" id="exportEmployee">
                                    <option value="">${pt('filterAllEmployees')}</option>
                                    ${employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">${pt('exportDateFrom')} *</label>
                                <input type="date" class="form-input" id="exportDateFrom" value="${yearStart}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">${pt('exportDateTo')} *</label>
                                <input type="date" class="form-input" id="exportDateTo" value="${today}" required>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">${pt('exportStatus')}</label>
                            <div class="checkbox-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="exportApproved" checked>
                                    <span class="badge badge-approved">${pt('filterApproved')}</span>
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" id="exportPending">
                                    <span class="badge badge-pending">${pt('filterPending')}</span>
                                </label>
                                <label class="checkbox-label">
                                    <input type="checkbox" id="exportRejected">
                                    <span class="badge badge-rejected">${pt('filterRejected')}</span>
                                </label>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">${pt('exportFormat')} *</label>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="exportFormat" value="xlsx" checked>
                                    <span>Excel (XLSX)</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="exportFormat" value="pdf">
                                    <span>PDF</span>
                                </label>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" onclick="closeModal(this.closest('.modal-backdrop'))">${pt('cancel')}</button>
                            <button type="submit" class="btn btn-primary" id="exportSubmitBtn">
                                <span style="margin-right:5px;">&#128190;</span> ${pt('exportGenerate')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleExport(event) {
    event.preventDefault();

    const type = document.getElementById('exportType').value;
    const employee = document.getElementById('exportEmployee').value;
    const dateFrom = document.getElementById('exportDateFrom').value;
    const dateTo = document.getElementById('exportDateTo').value;
    const format = document.querySelector('input[name="exportFormat"]:checked').value;

    // Get selected statuses
    const statuses = [];
    if (document.getElementById('exportApproved').checked) statuses.push('Approved');
    if (document.getElementById('exportPending').checked) statuses.push('Pending');
    if (document.getElementById('exportRejected').checked) statuses.push('Rejected');

    if (statuses.length === 0) {
        showToast(pt('exportStatusRequired'), 'error');
        return;
    }

    if (new Date(dateFrom) > new Date(dateTo)) {
        showToast(pt('dateRangeError'), 'error');
        return;
    }

    const submitBtn = document.getElementById('exportSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner-sm"></span> ${pt('exportGenerating')}`;

    try {
        const params = new URLSearchParams({
            type,
            employee,
            dateFrom,
            dateTo,
            statuses: statuses.join(','),
            format,
            lang: portalLang
        });

        const response = await apiCall(`/api/admin/export/tickets?${params}`);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Export failed');
        }

        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `export_${type || 'tickets'}_${dateFrom}_${dateTo}.${format}`;
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }

        // Download the file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        showToast(pt('exportSuccess'), 'success');
        closeModal(document.querySelector('.modal-backdrop'));
    } catch (error) {
        console.error('Export error:', error);
        showToast(error.message || pt('exportError'), 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span style="margin-right:5px;">&#128190;</span> ${pt('exportGenerate')}`;
    }
}

// ============================================
// ADMIN TICKET DETAIL MODAL
// ============================================

function openTicketDetailModal(ticketId) {
    const ticket = (window._adminTickets || []).find(t => String(t.ticket_id) === String(ticketId));
    if (!ticket) {
        showToast('Ticket not found', 'error');
        return;
    }

    const typeBadge = {'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[ticket.ticket_type] || 'user';

    const modalHtml = `
        <div class="modal-backdrop" onclick="closeModal(this)">
            <div class="modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>${pt('ticketDetailTitle')}: ${escapeHtml(ticket.ticket_id)}</h2>
                    <button class="modal-close" onclick="closeModal(this.closest('.modal-backdrop'))">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-grid">
                        <div class="detail-row">
                            <label>${pt('colName')}:</label>
                            <span><strong>${escapeHtml(ticket.title)}</strong></span>
                        </div>
                        <div class="detail-row">
                            <label>${pt('colType')}:</label>
                            <span><span class="badge badge-${typeBadge}">${translateType(ticket.ticket_type)}</span></span>
                        </div>
                        <div class="detail-row">
                            <label>${pt('colStatus')}:</label>
                            <span><span class="badge badge-${ticket.status.toLowerCase()}">${translateStatus(ticket.status)}</span></span>
                        </div>
                        <div class="detail-row">
                            <label>${pt('ticketDetailPriority')}:</label>
                            <span>${escapeHtml(ticket.priority || '-')}</span>
                        </div>
                        <div class="detail-row">
                            <label>${pt('colCreatedBy')}:</label>
                            <span><strong>${escapeHtml(ticket.created_by_name)}</strong><br><small style="color:var(--gray-500)">${escapeHtml(ticket.created_by_email)}</small></span>
                        </div>
                        <div class="detail-row">
                            <label>${pt('colApprover')}:</label>
                            <span>${ticket.assigned_approver_name ? `<strong>${escapeHtml(ticket.assigned_approver_name)}</strong><br><small style="color:var(--gray-500)">${escapeHtml(ticket.assigned_approver_email || '')}</small>` : '-'}</span>
                        </div>
                        ${ticket.start_date ? `
                        <div class="detail-row">
                            <label>${pt('colDates')}:</label>
                            <span>${formatDate(ticket.start_date)}${ticket.end_date ? ` - ${formatDate(ticket.end_date)}` : ''}</span>
                        </div>
                        ` : ''}
                        ${ticket.is_half_day ? `
                        <div class="detail-row">
                            <label>${pt('ticketDetailHalfDay')}:</label>
                            <span><span style="color:var(--green-600)">&#10003;</span> ${pt('yes')}</span>
                        </div>
                        ` : ''}
                        <div class="detail-row" style="grid-column: 1/-1;">
                            <label>${pt('ticketDetailDescription')}:</label>
                            <div style="padding:10px; background:var(--gray-50); border-radius:6px; margin-top:5px; white-space:pre-wrap;">${escapeHtml(ticket.description || '-')}</div>
                        </div>
                        <div class="detail-row">
                            <label>${pt('ticketDetailCreatedAt')}:</label>
                            <span>${formatDateTime(ticket.created_at)}</span>
                        </div>
                        <div class="detail-row">
                            <label>${pt('ticketDetailUpdatedAt')}:</label>
                            <span>${formatDateTime(ticket.updated_at)}</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal(this.closest('.modal-backdrop'))">${pt('close')}</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// ============================================
// ADMIN EDIT TICKET
// ============================================

async function openEditTicketModal(ticketId) {
    const ticket = (window._adminTickets || []).find(t => String(t.ticket_id) === String(ticketId));
    if (!ticket) {
        showToast('Ticket not found', 'error');
        return;
    }

    // Load active ticket types from API
    let types = [];
    try {
        const r = await apiCall('/api/ticket-types');
        types = ((await r.json()).data || []).filter(t => t.is_active);
    } catch (e) {
        types = [];
    }

    const fmtDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';

    const statusOptions = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
    const priorityOptions = ['Low', 'Medium', 'High', 'Urgent'];

    const modalHtml = `
        <div class="modal-backdrop" onclick="closeModal(this)">
            <div class="modal modal-lg" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>&#9999; ${pt('editTicketTitle') || 'Upraviť tiket'}: ${escapeHtml(ticket.ticket_id)}</h2>
                    <button class="modal-close" onclick="closeModal(this.closest('.modal-backdrop'))">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="editTicketForm" onsubmit="submitEditTicket(event, '${ticket.ticket_id}')">
                        <div class="form-group">
                            <label class="form-label">${pt('colName')} *</label>
                            <input type="text" class="form-input" name="title" value="${escapeHtml(ticket.title || '')}" required>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">${pt('colType')} *</label>
                                <select class="form-select" name="ticket_type" id="editTicketType" onchange="toggleEditDateFields()" required>
                                    ${types.length === 0 ? `
                                        <option value="vacation" ${ticket.ticket_type === 'vacation' ? 'selected' : ''}>Dovolenka</option>
                                        <option value="paragraph" ${ticket.ticket_type === 'paragraph' ? 'selected' : ''}>Paragraf</option>
                                        <option value="ocr" ${ticket.ticket_type === 'ocr' ? 'selected' : ''}>OČR</option>
                                        <option value="other" ${ticket.ticket_type === 'other' ? 'selected' : ''}>Iné</option>
                                    ` : types.map(t => `
                                        <option value="${escapeHtml(t.key)}" data-requires-dates="${t.requires_dates ? '1' : '0'}" ${ticket.ticket_type === t.key ? 'selected' : ''}>${escapeHtml(portalLang === 'sk' ? t.label_sk : t.label_en)}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">${pt('colStatus')} *</label>
                                <select class="form-select" name="status" id="editTicketStatus" onchange="toggleEditReasonFields()" required>
                                    ${statusOptions.map(s => `<option value="${s}" ${ticket.status === s ? 'selected' : ''}>${translateStatus(s)}</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="form-row" id="editTicketDateRow">
                            <div class="form-group">
                                <label class="form-label">${pt('ticketDetailStartDate') || pt('colStart') || 'Od'}</label>
                                <input type="date" class="form-input" name="start_date" value="${fmtDate(ticket.start_date)}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">${pt('ticketDetailEndDate') || pt('colEnd') || 'Do'}</label>
                                <input type="date" class="form-input" name="end_date" value="${fmtDate(ticket.end_date)}">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">${pt('ticketDetailPriority')}</label>
                                <select class="form-select" name="priority">
                                    ${priorityOptions.map(p => `<option value="${p}" ${(ticket.priority || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group" style="display:flex;align-items:flex-end;">
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="checkbox" name="is_half_day" ${ticket.is_half_day ? 'checked' : ''}>
                                    <span>${pt('ticketDetailHalfDay') || 'Polovica dňa'}</span>
                                </label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label">${pt('ticketDetailDescription')}</label>
                            <textarea class="form-input" name="description" rows="4">${escapeHtml(ticket.description || '')}</textarea>
                        </div>

                        <div class="form-group" id="editRejectionReasonGroup" style="display:${ticket.status === 'Rejected' ? 'block' : 'none'};">
                            <label class="form-label">${pt('reason') || 'Dôvod zamietnutia'}</label>
                            <textarea class="form-input" name="rejection_reason" rows="2">${escapeHtml(ticket.rejection_reason || '')}</textarea>
                        </div>

                        <div class="form-group" id="editCancellationReasonGroup" style="display:${ticket.status === 'Cancelled' ? 'block' : 'none'};">
                            <label class="form-label">${pt('cancelReason') || 'Dôvod zrušenia'}</label>
                            <textarea class="form-input" name="cancellation_reason" rows="2">${escapeHtml(ticket.cancellation_reason || '')}</textarea>
                        </div>

                        <div style="background:var(--amber-50, #fffbeb);border-left:3px solid var(--amber-500, #f59e0b);padding:10px;border-radius:6px;margin-top:1rem;font-size:0.85rem;color:var(--gray-700);">
                            &#9888; ${pt('editTicketWarning') || 'Pozor: zmena typu tiketu neovplyvní stiahnuté kvóty automaticky. Kvótu musíte upraviť ručne.'}
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal(this.closest('.modal-backdrop'))">${pt('cancel')}</button>
                    <button type="submit" form="editTicketForm" class="btn btn-primary">${pt('save')}</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    toggleEditDateFields();
}

function toggleEditDateFields() {
    const select = document.getElementById('editTicketType');
    if (!select) return;
    const opt = select.options[select.selectedIndex];
    const requiresDates = opt?.dataset?.requiresDates;
    const dateRow = document.getElementById('editTicketDateRow');
    if (!dateRow) return;
    // If we don't know (no metadata), keep visible for flexibility
    if (requiresDates === '0') {
        dateRow.style.opacity = '0.6';
    } else {
        dateRow.style.opacity = '1';
    }
}

function toggleEditReasonFields() {
    const status = document.getElementById('editTicketStatus')?.value;
    const rej = document.getElementById('editRejectionReasonGroup');
    const can = document.getElementById('editCancellationReasonGroup');
    if (rej) rej.style.display = status === 'Rejected' ? 'block' : 'none';
    if (can) can.style.display = status === 'Cancelled' ? 'block' : 'none';
}

async function submitEditTicket(event, ticketId) {
    event.preventDefault();
    const form = document.getElementById('editTicketForm');
    const fd = new FormData(form);

    const payload = {
        title: fd.get('title')?.trim(),
        description: fd.get('description')?.trim() || '',
        ticket_type: fd.get('ticket_type'),
        status: fd.get('status'),
        priority: fd.get('priority'),
        start_date: fd.get('start_date') || null,
        end_date: fd.get('end_date') || null,
        is_half_day: fd.get('is_half_day') === 'on',
        rejection_reason: fd.get('rejection_reason') || null,
        cancellation_reason: fd.get('cancellation_reason') || null
    };

    try {
        const response = await apiCall(`/api/admin/tickets/${ticketId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || pt('saveFailed') || 'Save failed');
        }
        showToast(pt('ticketUpdated') || 'Tiket bol upravený', 'success');
        // Close modal
        const modal = form.closest('.modal-backdrop');
        if (modal) modal.remove();
        // Refresh table
        await refreshAdminTickets();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString(portalLang === 'sk' ? 'sk-SK' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ============================================
// ADMIN TICKET TYPES
// ============================================

async function renderAdminTicketTypes(container) {
    const response = await apiCall('/api/ticket-types');
    const types = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('ticketTypesTitle')}</h1><p>${pt('ticketTypesDesc')}</p></div>
            <button class="btn btn-primary" onclick="openNewTicketTypeModal()">${pt('ticketTypesAddNew')}</button>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    ${types.length > 0 ? `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>${pt('ticketTypesColOrder')}</th>
                                    <th>${pt('ticketTypesColKey')}</th>
                                    <th>${pt('ticketTypesColSk')}</th>
                                    <th>${pt('ticketTypesColEn')}</th>
                                    <th>${pt('ticketTypesColDates')}</th>
                                    <th>${pt('ticketTypesColActive')}</th>
                                    <th>${pt('colActions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${types.map(t => `
                                    <tr style="${!t.is_active ? 'opacity:0.5;' : ''}">
                                        <td>${t.sort_order}</td>
                                        <td><code>${escapeHtml(t.key)}</code></td>
                                        <td>${escapeHtml(t.label_sk)}</td>
                                        <td>${escapeHtml(t.label_en)}</td>
                                        <td>${t.requires_dates ? '<span style="color:var(--green-600)">&#10003;</span>' : '<span style="color:var(--gray-400)">&#10005;</span>'}</td>
                                        <td>${t.is_active ? '<span class="badge badge-approved">' + pt('yes') + '</span>' : '<span class="badge badge-rejected">' + pt('no') + '</span>'}</td>
                                        <td>
                                            <div class="table-actions">
                                                <button class="btn-icon primary" onclick="editTicketType(${t.id}, '${escapeHtml(t.key)}', '${escapeHtml(t.label_sk)}', '${escapeHtml(t.label_en)}', ${t.requires_dates}, ${t.sort_order})" title="${pt('edit')}">&#9999;</button>
                                                <button class="btn-icon ${t.is_active ? '' : 'success'}" onclick="toggleTicketTypeActive(${t.id}, ${t.is_active})" title="${pt('ticketTypesToggleActive')}">${t.is_active ? '&#128683;' : '&#9989;'}</button>
                                                <button class="btn-icon danger" onclick="deleteTicketType(${t.id})" title="${pt('delete')}">&#128465;</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : `<div class="empty-state"><div class="empty-icon">&#9881;</div><div class="empty-text">${pt('ticketTypesEmpty')}</div></div>`}
                </div>
            </div>
        </div>
    `;
}

function openNewTicketTypeModal() {
    document.getElementById('modalTitle').textContent = pt('ticketTypesNewTitle');
    document.getElementById('modalBody').innerHTML = `
        <form id="ticketTypeForm">
            <div class="form-group">
                <label class="form-label">${pt('ticketTypesFieldKey')} *</label>
                <input type="text" class="form-input" name="key" required placeholder="napr. business-trip">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('ticketTypesFieldSk')} *</label>
                    <input type="text" class="form-input" name="label_sk" required placeholder="napr. Služobná cesta">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('ticketTypesFieldEn')} *</label>
                    <input type="text" class="form-input" name="label_en" required placeholder="e.g. Business Trip">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('ticketTypesFieldOrder')}</label>
                    <input type="number" class="form-input" name="sort_order" value="10" min="0" max="100">
                </div>
                <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:1.5rem;">
                    <input type="checkbox" id="ttRequiresDates" name="requires_dates">
                    <label for="ttRequiresDates" style="cursor:pointer;">${pt('ticketTypesFieldDates')}</label>
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitNewTicketType()">${pt('save')}</button>
    `;
    openModal();
}

async function submitNewTicketType() {
    const form = document.getElementById('ticketTypeForm');
    const data = {
        key: form.key.value,
        label_sk: form.label_sk.value,
        label_en: form.label_en.value,
        requires_dates: form.requires_dates.checked,
        sort_order: parseInt(form.sort_order.value) || 0
    };

    try {
        const response = await apiCall('/api/ticket-types', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || pt('saveFailed'));
        }
        showToast(pt('ticketTypesCreated'), 'success');
        closeModal();
        navigateToPage('admin-ticket-types');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function editTicketType(id, key, labelSk, labelEn, requiresDates, sortOrder) {
    document.getElementById('modalTitle').textContent = pt('ticketTypesEditTitle');
    document.getElementById('modalBody').innerHTML = `
        <form id="ticketTypeEditForm">
            <div class="form-group">
                <label class="form-label">${pt('ticketTypesColKey')}</label>
                <input type="text" class="form-input" value="${escapeHtml(key)}" disabled style="opacity:0.6;">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('ticketTypesFieldSk')} *</label>
                    <input type="text" class="form-input" name="label_sk" value="${escapeHtml(labelSk)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('ticketTypesFieldEn')} *</label>
                    <input type="text" class="form-input" name="label_en" value="${escapeHtml(labelEn)}" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('ticketTypesFieldOrder')}</label>
                    <input type="number" class="form-input" name="sort_order" value="${sortOrder}" min="0" max="100">
                </div>
                <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:1.5rem;">
                    <input type="checkbox" id="ttEditRequiresDates" name="requires_dates" ${requiresDates ? 'checked' : ''}>
                    <label for="ttEditRequiresDates" style="cursor:pointer;">${pt('ticketTypesFieldDates')}</label>
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitEditTicketType(${id})">${pt('save')}</button>
    `;
    openModal();
}

async function submitEditTicketType(id) {
    const form = document.getElementById('ticketTypeEditForm');
    const data = {
        label_sk: form.label_sk.value,
        label_en: form.label_en.value,
        requires_dates: form.requires_dates.checked,
        sort_order: parseInt(form.sort_order.value) || 0
    };

    try {
        const response = await apiCall(`/api/ticket-types/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || pt('saveFailed'));
        }
        showToast(pt('ticketTypesUpdated'), 'success');
        closeModal();
        navigateToPage('admin-ticket-types');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function toggleTicketTypeActive(id, currentActive) {
    try {
        const response = await apiCall(`/api/ticket-types/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: !currentActive })
        });
        if (!response.ok) throw new Error(pt('changeFailed'));
        navigateToPage('admin-ticket-types');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteTicketType(id) {
    if (!confirm(pt('ticketTypesDeleteConfirm'))) return;

    try {
        const response = await apiCall(`/api/ticket-types/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || pt('deleteFailed'));
        }
        showToast(pt('ticketTypesDeleted'), 'success');
        navigateToPage('admin-ticket-types');
    } catch (error) {
        showToast(pt('ticketTypesCannotDelete') + ': ' + error.message, 'error');
    }
}

// ============================================
// ADMIN SYSTEM MANAGEMENT
// ============================================

async function renderAdminSystem(container) {
    // Load data stats
    const statsRes = await apiCall('/api/admin/data/stats');
    const stats = (await statsRes.json()).data || {};

    // Load backups list
    const backupsRes = await apiCall('/api/admin/backups');
    const backups = (await backupsRes.json()).data || [];

    // Load SMTP config
    const smtpRes = await apiCall('/api/admin/settings/smtp');
    const smtp = smtpRes.ok ? ((await smtpRes.json()).data || {}) : {};

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('adminSystemTitle')}</h1><p>${pt('adminSystemDesc')}</p></div>
        </div>
        <div class="page-body">
            <!-- Data Statistics -->
            <div class="portal-card">
                <div class="card-header">
                    <h3>${pt('dataStatistics')}</h3>
                </div>
                <div class="card-body">
                    <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
                        <div class="stat-card">
                            <div class="stat-icon" style="background:#e0f2fe;color:#0284c7;">&#127915;</div>
                            <div><div class="stat-value">${stats.tickets || 0}</div><div class="stat-label">${pt('tickets')}</div></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon" style="background:#dcfce7;color:#16a34a;">&#128203;</div>
                            <div><div class="stat-value">${stats.sickNotes || 0}</div><div class="stat-label">${pt('sickNotes')}</div></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon" style="background:#fef3c7;color:#d97706;">&#128202;</div>
                            <div><div class="stat-value">${stats.quotas || 0}</div><div class="stat-label">${pt('quotas')}</div></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon" style="background:#f3e8ff;color:#9333ea;">&#128101;</div>
                            <div><div class="stat-value">${stats.users || 0}</div><div class="stat-label">${pt('users')}</div></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Data Management -->
            <div class="portal-card" style="margin-top: 1.5rem;">
                <div class="card-header">
                    <h3>${pt('dataManagement')}</h3>
                </div>
                <div class="card-body">
                    <p style="color: var(--gray-600); margin-bottom: 1rem;">${pt('dataManagementWarning')}</p>
                    <div style="display: flex; flex-wrap: wrap; gap: 1rem;">
                        <button class="btn btn-danger" onclick="confirmDeleteAllTickets()">
                            ${pt('deleteAllTickets')}
                        </button>
                        <button class="btn btn-danger" onclick="confirmDeleteAllSickNotes()">
                            ${pt('deleteAllSickNotes')}
                        </button>
                        <button class="btn btn-danger" onclick="confirmDeleteAllQuotas()">
                            ${pt('deleteAllQuotas')}
                        </button>
                        <button class="btn btn-warning" onclick="confirmResetQuotasUsed()">
                            ${pt('resetQuotasUsed')}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Database Backup -->
            <div class="portal-card" style="margin-top: 1.5rem;">
                <div class="card-header">
                    <h3>${pt('databaseBackup')}</h3>
                    <button class="btn btn-primary" onclick="triggerBackup()" id="backupBtn">
                        ${pt('createBackup')}
                    </button>
                </div>
                <div class="card-body">
                    <p style="color: var(--gray-600); margin-bottom: 1rem;">${pt('backupInfo')}</p>

                    ${backups.length > 0 ? `
                        <h4 style="margin-top: 1.5rem; margin-bottom: 0.75rem;">${pt('existingBackups')}</h4>
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>${pt('colName')}</th>
                                    <th>${pt('colSize')}</th>
                                    <th>${pt('colDate')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${backups.slice(0, 10).map(b => `
                                    <tr>
                                        <td><code>${escapeHtml(b.name)}</code></td>
                                        <td>${b.sizeFormatted}</td>
                                        <td>${formatDateTime(b.created)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        ${backups.length > 10 ? `<p style="color: var(--gray-500); margin-top: 0.5rem;">${pt('andMore').replace('{count}', backups.length - 10)}</p>` : ''}
                    ` : `
                        <div class="empty-state" style="padding: 2rem;">
                            <div class="empty-icon">&#128190;</div>
                            <div class="empty-text">${pt('noBackups')}</div>
                        </div>
                    `}
                </div>
            </div>

            <!-- SMTP Settings -->
            <div class="portal-card" style="margin-top: 1.5rem;">
                <div class="card-header">
                    <h3>&#128231; ${pt('smtpSettings')}</h3>
                    <span class="status-badge ${smtp.configured ? 'status-approved' : 'status-pending'}">
                        ${smtp.configured ? pt('smtpConfigured') : pt('smtpNotConfigured')}
                    </span>
                </div>
                <div class="card-body">
                    <p style="color: var(--gray-600); margin-bottom: 1.5rem;">${pt('smtpSettingsDesc')}</p>
                    <form id="smtpForm" onsubmit="saveSmtpSettings(event)" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div class="form-group">
                            <label class="form-label">${pt('smtpHost')}</label>
                            <input type="text" class="form-input" id="smtpHost" value="${escapeHtml(smtp.host || '')}" placeholder="smtp.gmail.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${pt('smtpPort')}</label>
                            <input type="number" class="form-input" id="smtpPort" value="${escapeHtml(smtp.port || '587')}" placeholder="587">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${pt('smtpUser')}</label>
                            <input type="email" class="form-input" id="smtpUser" value="${escapeHtml(smtp.user || '')}" placeholder="noreply@example.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${pt('smtpPass')}</label>
                            <input type="password" class="form-input" id="smtpPass" value="" placeholder="${pt('smtpPassPlaceholder')}">
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label class="form-label">${pt('smtpFrom')}</label>
                            <input type="text" class="form-input" id="smtpFrom" value="${escapeHtml(smtp.from || '')}" placeholder="${pt('smtpFromPlaceholder')}">
                        </div>
                        <div style="grid-column: 1 / -1; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                            <button type="submit" class="btn btn-primary" id="smtpSaveBtn">${pt('smtpSave')}</button>
                            <button type="button" class="btn btn-secondary" onclick="openSmtpTestModal()">${pt('smtpTest')}</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
}

async function confirmDeleteAllTickets() {
    if (!confirm(pt('deleteAllTicketsConfirm'))) return;
    if (!confirm(pt('deleteConfirmSecond'))) return;

    try {
        const response = await apiCall('/api/admin/data/tickets', { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('deleteFailed'));
        showToast(result.message, 'success');
        navigateToPage('admin-system');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function confirmDeleteAllSickNotes() {
    if (!confirm(pt('deleteAllSickNotesConfirm'))) return;
    if (!confirm(pt('deleteConfirmSecond'))) return;

    try {
        const response = await apiCall('/api/admin/data/sick-notes', { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('deleteFailed'));
        showToast(result.message, 'success');
        navigateToPage('admin-system');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function confirmDeleteAllQuotas() {
    if (!confirm(pt('deleteAllQuotasConfirm'))) return;
    if (!confirm(pt('deleteConfirmSecond'))) return;

    try {
        const response = await apiCall('/api/admin/data/quotas', { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('deleteFailed'));
        showToast(result.message, 'success');
        navigateToPage('admin-system');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function confirmResetQuotasUsed() {
    const year = new Date().getFullYear();
    if (!confirm(pt('resetQuotasUsedConfirm').replace('{year}', year))) return;

    try {
        const response = await apiCall(`/api/admin/data/quotas/reset-used?year=${year}`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('changeFailed'));
        showToast(result.message, 'success');
        navigateToPage('admin-system');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function triggerBackup() {
    const btn = document.getElementById('backupBtn');
    btn.disabled = true;
    btn.textContent = pt('creatingBackup');

    try {
        const response = await apiCall('/api/admin/backup', { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('backupFailed'));
        showToast(pt('backupCreated') + ': ' + result.data.file, 'success');
        navigateToPage('admin-system');
    } catch (error) {
        showToast(error.message, 'error');
        btn.disabled = false;
        btn.textContent = pt('createBackup');
    }
}

async function saveSmtpSettings(event) {
    event.preventDefault();
    const btn = document.getElementById('smtpSaveBtn');
    btn.disabled = true;

    const payload = {
        host: document.getElementById('smtpHost').value.trim(),
        port: document.getElementById('smtpPort').value.trim(),
        user: document.getElementById('smtpUser').value.trim(),
        pass: document.getElementById('smtpPass').value,
        from: document.getElementById('smtpFrom').value.trim()
    };

    try {
        const response = await apiCall('/api/admin/settings/smtp', { method: 'PUT', body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('smtpSaveFailed'));
        showToast(pt('smtpSaved'), 'success');
        navigateToPage('admin-system');
    } catch (error) {
        showToast(error.message, 'error');
        btn.disabled = false;
    }
}

function openSmtpTestModal() {
    document.getElementById('modalTitle').textContent = pt('smtpTest');
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label class="form-label">${pt('smtpTestEmail')}</label>
            <input type="email" class="form-input" id="smtpTestEmailInput" placeholder="vas@email.com">
        </div>`;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="sendSmtpTest()">${pt('smtpTestSend')}</button>`;
    openModal();
}

async function sendSmtpTest() {
    const to = document.getElementById('smtpTestEmailInput')?.value?.trim();
    if (!to) { showToast(pt('smtpTestEmail'), 'warning'); return; }

    try {
        const response = await apiCall('/api/admin/settings/smtp/test', { method: 'POST', body: JSON.stringify({ to }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || pt('smtpTestFailed'));
        showToast(result.message || pt('smtpTestSuccess'), 'success');
        closeModal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString(portalLang === 'sk' ? 'sk-SK' : 'en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ============================================
// HELPERS
// ============================================

function renderTicketsTable(tickets) {
    if (!tickets.length) return `<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">${pt('noTickets')}</div></div>`;
    return `
        <div class="portal-card">
            <div class="card-body" style="overflow-x:auto;">
                <table class="data-table">
                    <thead>
                        <tr><th>${pt('colName')}</th><th>${pt('colType')}</th><th>${pt('colApprover')}</th><th>${pt('colStatus')}</th><th>${pt('colDate')}</th><th>${pt('colAttachments')}</th><th>${pt('colActions')}</th></tr>
                    </thead>
                    <tbody>
                        ${tickets.map(t => `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(t.title)}</strong>
                                    ${t.rejection_reason ? `<br><small style="color:var(--red-500)">${pt('reason')}: ${escapeHtml(t.rejection_reason)}</small>` : ''}
                                    ${t.status === 'Cancelled' && t.cancellation_reason ? `<br><small style="color:var(--gray-500)">${pt('cancelReason')}: ${escapeHtml(t.cancellation_reason)}</small>` : ''}
                                </td>
                                <td><span class="badge badge-${{'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[t.ticket_type] || 'user'}">${translateType(t.ticket_type)}</span></td>
                                <td>${t.assigned_approver_name ? escapeHtml(t.assigned_approver_name) : '-'}</td>
                                <td><span class="badge badge-${t.status.toLowerCase()}">${translateStatus(t.status)}</span></td>
                                <td>${formatDate(t.created_at)}${t.start_date ? `<br><small>${formatDate(t.start_date)} - ${formatDate(t.end_date)}</small>` : ''}</td>
                                <td>
                                    ${t.attachment_count > 0 ? `<button class="btn btn-ghost btn-sm" onclick="openTicketAttachments('${t.ticket_id}', '${escapeHtml(t.title)}')">&#128206; ${pt('attachments')} (${t.attachment_count})</button>` : '<span style="color:var(--gray-300)">—</span>'}
                                </td>
                                <td>
                                    ${(t.status === 'Pending' || t.status === 'Approved') ? `<button class="btn-icon danger" onclick="openCancelTicketModal('${t.ticket_id}', '${escapeHtml(t.title)}')" title="${pt('btnCancelTicket')}">&#10005;</button>` : '<span style="color:var(--gray-300)">—</span>'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Cancel ticket modal & logic
let _pendingCancelTicketId = null;

function openCancelTicketModal(ticketId, title) {
    _pendingCancelTicketId = ticketId;
    document.getElementById('modalTitle').textContent = `${pt('cancelModalTitle')} - ${title}`;
    document.getElementById('modalBody').innerHTML = `
        <p style="margin-bottom:1rem;color:var(--gray-600);font-size:0.9rem;">${pt('cancelModalDesc')}</p>
        <div class="form-group">
            <label class="form-label">${pt('cancelReasonLabel')}</label>
            <textarea id="cancelReasonInput" class="form-textarea" rows="3" placeholder="${pt('cancelReasonPlaceholder')}" required></textarea>
        </div>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-danger" onclick="submitCancelTicket()">&#10005; ${pt('btnCancelTicket')}</button>
    `;
    openModal();
    setTimeout(() => document.getElementById('cancelReasonInput')?.focus(), 200);
}

async function submitCancelTicket() {
    const reason = document.getElementById('cancelReasonInput')?.value?.trim();
    if (!reason) {
        showToast(pt('cancelReasonRequired'), 'error');
        return;
    }
    try {
        const response = await apiCall(`/api/tickets/${_pendingCancelTicketId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ cancellationReason: reason })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.message || pt('cancelFailed'));
        }
        closeModal();
        showToast(pt('cancelSuccess'), 'success');
        _pendingCancelTicketId = null;
        navigateToPage('my-requests');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function openTicketAttachments(ticketId, title) {
    document.getElementById('modalTitle').textContent = `${pt('attachments')}${title ? ` - ${title}` : ''}`;
    document.getElementById('modalBody').innerHTML = `<div class="empty-state"><div class="empty-icon">&#128206;</div><div class="empty-text">${pt('loading')}</div></div>`;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('close')}</button>
    `;
    openModal();

    try {
        const response = await apiCall(`/api/tickets/${ticketId}/attachments`);
        if (!response.ok) throw new Error(pt('fileLoadError'));
        const result = await response.json();
        const attachments = result.data || [];

        if (!attachments.length) {
            document.getElementById('modalBody').innerHTML = `<div class="empty-state"><div class="empty-icon">&#128206;</div><div class="empty-text">${pt('noAttachments')}</div></div>`;
            return;
        }

        document.getElementById('modalBody').innerHTML = `
            <div class="attachments-list">
                ${attachments.map(att => `
                    <div class="attachment-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--gray-100,#f3f4f6);">
                        <div>
                            <div style="font-weight:600;">${escapeHtml(att.file_name)}</div>
                            <div style="color:var(--gray-500);font-size:12px;">${att.file_type || ''}</div>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button class="btn btn-secondary btn-sm" onclick="previewTicketAttachment('${ticketId}', ${att.attachment_id}, '${escapeHtml(att.file_name)}')">${pt('viewAttachments')}</button>
                            <a class="btn btn-primary btn-sm" href="/api/tickets/${ticketId}/attachments/${att.attachment_id}" target="_blank" rel="noopener">${pt('download')}</a>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        document.getElementById('modalBody').innerHTML = `<div class="empty-state"><div class="empty-icon">&#9888;</div><div class="empty-text">${pt('fileLoadError')}: ${error.message}</div></div>`;
    }
}

async function previewTicketAttachment(ticketId, attachmentId, fileName) {
    try {
        const response = await apiCall(`/api/tickets/${ticketId}/attachments/${attachmentId}`);
        if (!response.ok) throw new Error(pt('fileNotFound'));
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        showFileLightbox(url, fileName);
    } catch (error) {
        showToast(pt('fileLoadError') + ': ' + error.message, 'error');
    }
}

function showFileLightbox(url, fileName) {
    const existing = document.getElementById('fileLightbox');
    if (existing) existing.remove();

    const ext = fileName.toLowerCase().split('.').pop();
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif'].includes(ext);
    const isPdf = ext === 'pdf';

    const overlay = document.createElement('div');
    overlay.id = 'fileLightbox';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

    const cleanup = () => {
        overlay.remove();
        window.URL.revokeObjectURL(url);
        document.removeEventListener('keydown', escHandler);
    };

    overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); } };

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;max-width:90vw;max-height:90vh;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.3);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--gray-50,#f9fafb);border-bottom:1px solid var(--gray-200,#e5e7eb);';

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;font-size:14px;color:#374151;';
    title.textContent = fileName;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.style.cssText = 'padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;';
    downloadBtn.title = pt('download');
    downloadBtn.innerHTML = `&#11015; ${pt('download')}`;
    downloadBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'padding:6px 10px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;font-size:16px;line-height:1;';
    closeBtn.title = pt('close');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        cleanup();
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(actions);
    wrapper.appendChild(header);

    const content = document.createElement('div');
    content.style.cssText = 'display:flex;align-items:center;justify-content:center;max-height:calc(90vh - 52px);overflow:auto;';

    if (isImage) {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'max-width:88vw;max-height:calc(90vh - 60px);object-fit:contain;';
        content.appendChild(img);
    } else if (isPdf) {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.style.cssText = 'width:88vw;height:calc(90vh - 60px);border:none;';
        content.appendChild(iframe);
    } else {
        content.innerHTML = `<div style="padding:40px;text-align:center;"><p style="margin-bottom:16px;">${pt('previewNotAvailable')}</p><a href="${url}" download="${escapeHtml(fileName)}" style="color:var(--blue-600,#2563eb);">&#11015; ${pt('downloadFile')}</a></div>`;
    }

    wrapper.appendChild(content);
    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    const escHandler = (e) => { if (e.key === 'Escape') { cleanup(); } };
    document.addEventListener('keydown', escHandler);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('sk-SK', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Modal
function openModal() {
    document.getElementById('modalOverlay').classList.add('active');
}

function closeModal(eventOrElement) {
    // Handle ticket detail popup (modal-backdrop inserted into body)
    if (eventOrElement && eventOrElement.classList && eventOrElement.classList.contains('modal-backdrop')) {
        eventOrElement.remove();
        return;
    }

    // Handle click on backdrop (event bubbling check)
    if (eventOrElement && eventOrElement.target && eventOrElement.target !== eventOrElement.currentTarget) {
        return;
    }

    // Handle standard modal overlay
    document.getElementById('modalOverlay').classList.remove('active');
}

// ============================================
// WAREHOUSE MODULE
// ============================================

// Module-level state
let warehouseLocations = [];          // [{id, zone, position, code, material_count, total_quantity}]
let warehouseLocByKey = {};           // "A-1" -> location
let warehouseSearchTimer = null;

function whLocKey(zone, num) {
    return `${zone}-${num}`;
}

async function renderWarehouseDashboard(container) {
    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('whDashboardTitle')}</h1><p>${pt('whDashboardDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="stats-grid" id="whStats">
                <div class="stat-card"><div class="stat-icon" style="background:#dbeafe;color:#2563eb;">&#128230;</div><div><div class="stat-value" id="whStatMaterials">-</div><div class="stat-label">${pt('whStatMaterials')}</div></div></div>
                <div class="stat-card"><div class="stat-icon" style="background:#dcfce7;color:#16a34a;">&#128205;</div><div><div class="stat-value" id="whStatOccupied">-</div><div class="stat-label">${pt('whStatOccupied')}</div></div></div>
                <div class="stat-card"><div class="stat-icon" style="background:#fef3c7;color:#d97706;">&#128200;</div><div><div class="stat-value" id="whStatToday">-</div><div class="stat-label">${pt('whStatToday')}</div></div></div>
            </div>

            <div class="portal-card">
                <div class="card-body">
                    <div class="wh-search-wrap">
                        <input type="text" id="whDashSearch" class="form-control wh-search-input" placeholder="${pt('whSearchPlaceholder')}" autocomplete="off">
                        <div class="wh-search-results" id="whDashResults"></div>
                    </div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header"><h2>${pt('whMapTitle')}</h2></div>
                <div class="card-body">
                    <div class="wh-map-container" id="whMap">
                        <div class="empty-state"><div class="spinner"></div></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    await Promise.all([loadWarehouseStats(), loadWarehouseMap()]);

    // Wire dashboard search
    const searchInput = document.getElementById('whDashSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(warehouseSearchTimer);
            warehouseSearchTimer = setTimeout(() => warehouseDashSearch(searchInput.value), 300);
        });
    }
}

async function loadWarehouseStats() {
    try {
        const res = await apiCall('/api/warehouse/stats');
        const s = (await res.json()).data || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('whStatMaterials', s.total_materials ?? 0);
        set('whStatOccupied', `${s.occupied_locations ?? 0}/${s.total_locations ?? 0}`);
        set('whStatToday', s.added_today ?? 0);
    } catch (e) { console.error('wh stats', e); }
}

async function loadWarehouseMap() {
    const mapEl = document.getElementById('whMap');
    if (!mapEl) return;
    try {
        const [locRes, svgText] = await Promise.all([
            apiCall('/api/warehouse/locations'),
            fetch('/portal/assets/images/warehouse-map.svg').then(r => r.text())
        ]);
        warehouseLocations = (await locRes.json()).data || [];
        warehouseLocByKey = {};
        warehouseLocations.forEach(l => { warehouseLocByKey[whLocKey(l.zone, l.position)] = l; });

        mapEl.innerHTML = svgText;

        // Color + wire each pallet location
        mapEl.querySelectorAll('.pallet-loc').forEach(el => {
            const zone = el.dataset.zone;
            const num = el.dataset.num;
            const loc = warehouseLocByKey[whLocKey(zone, num)];
            if (loc) {
                el.dataset.locationId = loc.id;
                if (loc.material_count > 0) {
                    el.classList.add('wh-occupied');
                    el.parentElement && el.parentElement.classList.add('wh-has-items');
                }
                el.addEventListener('click', () => openLocationModal(loc.id));
                el.addEventListener('mouseenter', (ev) => showLocationTooltip(ev, loc));
                el.addEventListener('mouseleave', hideLocationTooltip);
            }
        });
    } catch (e) {
        console.error('wh map', e);
        mapEl.innerHTML = `<div class="empty-state"><div class="empty-text">${pt('pageLoadError')}</div></div>`;
    }
}

// --- Tooltip ---
let whTooltipEl = null;
function showLocationTooltip(ev, loc) {
    hideLocationTooltip();
    whTooltipEl = document.createElement('div');
    whTooltipEl.className = 'wh-tooltip';
    whTooltipEl.innerHTML = loc.material_count > 0
        ? `<strong>${escapeHtml(loc.code)}</strong> · ${loc.material_count} ${pt('whTooltipItems')}`
        : `<strong>${escapeHtml(loc.code)}</strong> · ${pt('whTooltipEmpty')}`;
    document.body.appendChild(whTooltipEl);
    moveTooltip(ev);
    ev.target.addEventListener('mousemove', moveTooltip);
}
function moveTooltip(ev) {
    if (!whTooltipEl) return;
    whTooltipEl.style.left = (ev.clientX + 14) + 'px';
    whTooltipEl.style.top = (ev.clientY + 14) + 'px';
}
function hideLocationTooltip() {
    if (whTooltipEl) { whTooltipEl.remove(); whTooltipEl = null; }
}

// --- Location modal (materials at a location) ---
async function openLocationModal(locationId) {
    document.getElementById('modalTitle').textContent = pt('whLocationTitle');
    document.getElementById('modalBody').innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
    document.getElementById('modalFooter').innerHTML = `<button class="btn btn-secondary" onclick="closeModal()">${pt('close')}</button>`;
    openModal();

    try {
        const res = await apiCall(`/api/warehouse/locations/${locationId}/materials`);
        const { location, materials } = (await res.json()).data;
        document.getElementById('modalTitle').textContent = `${pt('whLocationTitle')} ${location.code}`;
        document.getElementById('modalBody').innerHTML = `
            ${materials.length > 0 ? `
                <table class="data-table">
                    <thead><tr><th>${pt('whColCode')}</th><th>${pt('whColName')}</th><th>${pt('whColQty')}</th><th>${pt('whColCategory')}</th></tr></thead>
                    <tbody>
                        ${materials.map(m => `
                            <tr>
                                <td><strong>${escapeHtml(m.code)}</strong></td>
                                <td>${escapeHtml(m.name)}</td>
                                <td>${m.quantity} ${escapeHtml(m.unit || '')}</td>
                                <td>${m.category_name ? `<span class="badge" style="background:${m.category_color || '#e2e8f0'}22;color:${m.category_color || '#475569'}">${escapeHtml(m.category_name)}</span>` : '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : `<div class="empty-state"><div class="empty-icon">&#128230;</div><div class="empty-text">${pt('whLocationEmpty')}</div></div>`}
            ${location.notes ? `<p style="margin-top:1rem;color:#64748b;"><strong>${pt('whNotes')}:</strong> ${escapeHtml(location.notes)}</p>` : ''}
        `;
    } catch (e) {
        document.getElementById('modalBody').innerHTML = `<div class="empty-state"><div class="empty-text">${pt('pageLoadError')}</div></div>`;
    }
}

// --- Dashboard search (find material -> highlight on map) ---
async function warehouseDashSearch(query) {
    const resultsEl = document.getElementById('whDashResults');
    if (!resultsEl) return;
    clearMapHighlights();
    if (!query || query.trim().length < 1) { resultsEl.innerHTML = ''; resultsEl.classList.remove('active'); return; }

    try {
        const res = await apiCall(`/api/warehouse/materials?search=${encodeURIComponent(query.trim())}`);
        const materials = (await res.json()).data || [];
        if (materials.length === 0) {
            resultsEl.innerHTML = `<div class="wh-search-empty">${pt('whSearchNoResults')}</div>`;
            resultsEl.classList.add('active');
            return;
        }
        resultsEl.innerHTML = materials.slice(0, 20).map(m => `
            <div class="wh-search-item" onclick="warehouseFocusMaterial(${m.location_id || 'null'}, '${escapeHtml(m.location_zone || '')}', ${m.location_position || 'null'})">
                <span class="wh-search-code">${escapeHtml(m.code)}</span>
                <span class="wh-search-name">${escapeHtml(m.name)}</span>
                <span class="wh-search-loc">${m.location_code ? escapeHtml(m.location_code) : pt('whNoLocation')}</span>
            </div>
        `).join('');
        resultsEl.classList.add('active');
    } catch (e) { console.error('wh search', e); }
}

function warehouseFocusMaterial(locationId, zone, position) {
    clearMapHighlights();
    if (!zone || position == null) { showToast(pt('whNoLocation'), 'info'); return; }
    const el = document.querySelector(`#whMap .pallet-loc[data-zone="${zone}"][data-num="${position}"]`);
    if (el) {
        el.classList.add('highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (locationId) openLocationModal(locationId);
    }
}

function clearMapHighlights() {
    document.querySelectorAll('#whMap .pallet-loc.highlight').forEach(el => el.classList.remove('highlight'));
}

// --- Materials CRUD (Fáza 4) ---
let whCategories = [];
let whMaterialsList = [];
let whAllLocations = [];
let whSelectedLocationId = null;

async function renderWarehouseMaterials(container) {
    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('whMaterialsTitle')}</h1><p>${pt('whMaterialsDesc')}</p></div>
            <button class="btn btn-primary" onclick="openMaterialModal()">+ ${pt('whAddMaterial')}</button>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body">
                    <div class="wh-filter-bar">
                        <input type="text" id="whMatSearch" class="form-control" placeholder="${pt('whSearchPlaceholder')}" style="flex:2;">
                        <select id="whMatCategory" class="form-control" style="flex:1;"><option value="">${pt('whAllCategories')}</option></select>
                        <select id="whMatZone" class="form-control" style="flex:1;">
                            <option value="">${pt('whAllZones')}</option>
                            <option value="MINI">MINI</option><option value="D">D</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
                        </select>
                        <button class="btn btn-secondary" onclick="loadMaterialsTable()">${pt('whFilter')}</button>
                    </div>
                </div>
            </div>
            <div class="portal-card">
                <div class="card-body">
                    <div id="whMaterialsTable"><div class="empty-state"><div class="spinner"></div></div></div>
                </div>
            </div>
        </div>
    `;
    // Load categories for filter + modal
    try {
        const catRes = await apiCall('/api/warehouse/categories');
        whCategories = (await catRes.json()).data || [];
        const catSel = document.getElementById('whMatCategory');
        if (catSel) whCategories.forEach(c => {
            const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; catSel.appendChild(opt);
        });
    } catch (e) { console.error('wh cats', e); }
    // Load locations for map picker
    try {
        const locRes = await apiCall('/api/warehouse/locations');
        whAllLocations = (await locRes.json()).data || [];
    } catch (e) { console.error('wh locs', e); }
    // Wire search
    const searchEl = document.getElementById('whMatSearch');
    if (searchEl) searchEl.addEventListener('keyup', e => { if (e.key === 'Enter') loadMaterialsTable(); });
    await loadMaterialsTable();
}

async function loadMaterialsTable() {
    const tableEl = document.getElementById('whMaterialsTable');
    if (!tableEl) return;
    const search = document.getElementById('whMatSearch')?.value || '';
    const category = document.getElementById('whMatCategory')?.value || '';
    const zone = document.getElementById('whMatZone')?.value || '';
    let url = '/api/warehouse/materials?';
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (category) url += `category_id=${category}&`;
    if (zone) url += `zone=${zone}&`;
    try {
        const res = await apiCall(url);
        whMaterialsList = (await res.json()).data || [];
        if (whMaterialsList.length === 0) {
            tableEl.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128230;</div><div class="empty-text">${pt('whMaterialsEmpty')}</div></div>`;
            return;
        }
        tableEl.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>${pt('whColCode')}</th><th>${pt('whColName')}</th><th>${pt('whColQty')}</th>
                    <th>${pt('whColLocation')}</th><th>${pt('whColCategory')}</th><th>${pt('colActions')}</th>
                </tr></thead>
                <tbody>
                    ${whMaterialsList.map(m => `
                        <tr>
                            <td><strong>${escapeHtml(m.code)}</strong></td>
                            <td>${escapeHtml(m.name)}${m.description ? `<br><small style="color:#64748b">${escapeHtml(m.description.substring(0,60))}${m.description.length > 60 ? '...' : ''}</small>` : ''}</td>
                            <td>${m.quantity} ${escapeHtml(m.unit || 'ks')}</td>
                            <td>${m.location_code ? `<span class="wh-loc-badge">${escapeHtml(m.location_code)}</span>` : `<em style="color:#94a3b8">${pt('whNoLocation')}</em>`}</td>
                            <td>${m.category_name ? `<span class="badge" style="background:${m.category_color || '#e2e8f0'}22;color:${m.category_color || '#475569'}">${escapeHtml(m.category_name)}</span>` : '-'}</td>
                            <td>
                                <div class="table-actions">
                                    <button class="btn-icon" onclick="openMaterialModal(${m.id})" title="${pt('edit')}">&#9998;</button>
                                    <button class="btn-icon" onclick="openMoveModal(${m.id}, '${escapeHtml(m.code)}')" title="${pt('whMove')}">&#128257;</button>
                                    <button class="btn-icon" onclick="deleteMaterial(${m.id}, '${escapeHtml(m.code)}')" title="${pt('delete')}">&#128465;</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        console.error('wh materials', e);
        tableEl.innerHTML = `<div class="empty-state"><div class="empty-text">${pt('pageLoadError')}</div></div>`;
    }
}

// --- Material modal (create / edit) ---
async function openMaterialModal(materialId = null) {
    const isEdit = !!materialId;
    let mat = null;
    if (isEdit) {
        try {
            const res = await apiCall(`/api/warehouse/materials/${materialId}`);
            mat = (await res.json()).data;
        } catch (e) { showToast(pt('pageLoadError'), 'error'); return; }
    }
    whSelectedLocationId = mat?.location_id || null;

    document.getElementById('modalTitle').textContent = isEdit ? pt('whEditMaterial') : pt('whAddMaterial');
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group"><label>${pt('whColCode')} *</label><input type="text" id="matCode" class="form-control" value="${mat ? escapeHtml(mat.code) : ''}" required></div>
        <div class="form-group"><label>${pt('whColName')} *</label><input type="text" id="matName" class="form-control" value="${mat ? escapeHtml(mat.name) : ''}"></div>
        <div class="form-group"><label>${pt('whDescription')}</label><textarea id="matDesc" class="form-control" rows="2">${mat ? escapeHtml(mat.description || '') : ''}</textarea></div>
        <div class="form-row">
            <div class="form-group" style="flex:1"><label>${pt('whColQty')}</label><input type="number" id="matQty" class="form-control" min="0" value="${mat ? mat.quantity : 1}"></div>
            <div class="form-group" style="flex:1"><label>${pt('whUnit')}</label><input type="text" id="matUnit" class="form-control" value="${mat ? escapeHtml(mat.unit || 'ks') : 'ks'}"></div>
        </div>
        <div class="form-group">
            <label>${pt('whColCategory')}</label>
            <select id="matCategory" class="form-control">
                <option value="">— ${pt('whNoCategory')} —</option>
                ${whCategories.map(c => `<option value="${c.id}" ${mat && mat.category_id == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>${pt('whColLocation')}</label>
            <div class="wh-loc-picker">
                <input type="text" id="matLocDisplay" class="form-control" readonly placeholder="${pt('whClickMap')}" value="${mat?.location_code || ''}">
                <button type="button" class="btn btn-secondary btn-sm" onclick="toggleLocPicker()">${pt('whPickLocation')}</button>
            </div>
            <div id="whLocPickerMap" class="wh-picker-map" style="display:none;"></div>
        </div>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="saveMaterial(${materialId || 'null'})">${pt('save')}</button>
    `;
    openModal();
}

async function toggleLocPicker() {
    const mapEl = document.getElementById('whLocPickerMap');
    if (!mapEl) return;
    if (mapEl.style.display === 'none') {
        mapEl.style.display = 'block';
        if (!mapEl.innerHTML || mapEl.innerHTML.trim() === '') {
            const svgText = await fetch('/portal/assets/images/warehouse-map.svg').then(r => r.text());
            mapEl.innerHTML = svgText;
            mapEl.querySelectorAll('.pallet-loc').forEach(el => {
                const zone = el.dataset.zone, num = el.dataset.num;
                const loc = whAllLocations.find(l => l.zone === zone && l.position == num);
                if (loc) {
                    el.style.cursor = 'pointer';
                    el.addEventListener('click', () => selectLocation(loc));
                }
            });
        }
    } else {
        mapEl.style.display = 'none';
    }
}

function selectLocation(loc) {
    whSelectedLocationId = loc.id;
    const disp = document.getElementById('matLocDisplay');
    if (disp) disp.value = loc.code;
    document.getElementById('whLocPickerMap').style.display = 'none';
    showToast(`${pt('whLocationSelected')}: ${loc.code}`, 'success');
}

async function saveMaterial(materialId) {
    const code = document.getElementById('matCode')?.value.trim();
    const name = document.getElementById('matName')?.value.trim();
    if (!code || !name) { showToast(pt('whRequiredFields'), 'error'); return; }
    const body = {
        code, name,
        description: document.getElementById('matDesc')?.value || null,
        quantity: parseInt(document.getElementById('matQty')?.value, 10) || 0,
        unit: document.getElementById('matUnit')?.value || 'ks',
        category_id: document.getElementById('matCategory')?.value || null,
        location_id: whSelectedLocationId
    };
    try {
        const url = materialId ? `/api/warehouse/materials/${materialId}` : '/api/warehouse/materials';
        const method = materialId ? 'PUT' : 'POST';
        const res = await apiCall(url, { method, body: JSON.stringify(body) });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        showToast(materialId ? pt('whMaterialUpdated') : pt('whMaterialCreated'), 'success');
        closeModal();
        await loadMaterialsTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// --- Move / relocate modal ---
async function openMoveModal(materialId, code) {
    whSelectedLocationId = null;
    document.getElementById('modalTitle').textContent = `${pt('whMove')}: ${code}`;
    document.getElementById('modalBody').innerHTML = `
        <p>${pt('whMoveInstructions')}</p>
        <div id="whMovePickerMap" class="wh-picker-map" style="display:block;max-height:400px;overflow:auto;"></div>
        <div class="form-group" style="margin-top:1rem;">
            <label>${pt('whMoveReason')}</label>
            <input type="text" id="moveReason" class="form-control" placeholder="${pt('whMoveReasonPlaceholder')}">
        </div>
        <input type="hidden" id="moveMatId" value="${materialId}">
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitMove()">${pt('whMoveConfirm')}</button>
    `;
    openModal();
    // Load map
    const mapEl = document.getElementById('whMovePickerMap');
    const svgText = await fetch('/portal/assets/images/warehouse-map.svg').then(r => r.text());
    mapEl.innerHTML = svgText;
    mapEl.querySelectorAll('.pallet-loc').forEach(el => {
        const zone = el.dataset.zone, num = el.dataset.num;
        const loc = whAllLocations.find(l => l.zone === zone && l.position == num);
        if (loc) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                mapEl.querySelectorAll('.pallet-loc.selected').forEach(s => s.classList.remove('selected'));
                el.classList.add('selected');
                whSelectedLocationId = loc.id;
            });
        }
    });
}

async function submitMove() {
    const materialId = document.getElementById('moveMatId')?.value;
    if (!whSelectedLocationId) { showToast(pt('whSelectLocation'), 'error'); return; }
    const reason = document.getElementById('moveReason')?.value || null;
    try {
        const res = await apiCall(`/api/warehouse/materials/${materialId}/move`, {
            method: 'PATCH', body: JSON.stringify({ to_location_id: whSelectedLocationId, reason })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        showToast(pt('whMaterialMoved'), 'success');
        closeModal();
        await loadMaterialsTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// --- Delete ---
async function deleteMaterial(id, code) {
    if (!confirm(`${pt('whDeleteConfirm')} "${code}"?`)) return;
    try {
        const res = await apiCall(`/api/warehouse/materials/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        showToast(pt('whMaterialDeleted'), 'success');
        await loadMaterialsTable();
    } catch (e) { showToast(e.message, 'error'); }
}

// --- Movements page ---
async function renderWarehouseMovements(container) {
    container.innerHTML = `
        <div class="page-header"><div><h1>${pt('whMovementsTitle')}</h1><p>${pt('whMovementsDesc')}</p></div></div>
        <div class="page-body"><div class="portal-card"><div class="card-body" id="whMovementsTable">
            <div class="empty-state"><div class="spinner"></div></div>
        </div></div></div>`;
    try {
        const res = await apiCall('/api/warehouse/movements');
        const movements = (await res.json()).data || [];
        const tableEl = document.getElementById('whMovementsTable');
        if (movements.length === 0) {
            tableEl.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128257;</div><div class="empty-text">${pt('whMovementsEmpty')}</div></div>`;
            return;
        }
        tableEl.innerHTML = `
            <table class="data-table">
                <thead><tr><th>${pt('whColDate')}</th><th>${pt('whColMaterial')}</th><th>${pt('whColFrom')}</th><th>${pt('whColTo')}</th><th>${pt('whColUser')}</th><th>${pt('whColReason')}</th></tr></thead>
                <tbody>
                    ${movements.map(m => `
                        <tr>
                            <td>${formatDate(m.moved_at)}</td>
                            <td><strong>${escapeHtml(m.material_code || '-')}</strong><br><small>${escapeHtml(m.material_name || '')}</small></td>
                            <td>${m.from_code ? `<span class="wh-loc-badge">${escapeHtml(m.from_code)}</span>` : '-'}</td>
                            <td>${m.to_code ? `<span class="wh-loc-badge">${escapeHtml(m.to_code)}</span>` : '-'}</td>
                            <td>${escapeHtml(m.moved_by_name || '-')}</td>
                            <td>${escapeHtml(m.reason || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        document.getElementById('whMovementsTable').innerHTML = `<div class="empty-state"><div class="empty-text">${pt('pageLoadError')}</div></div>`;
    }
}

// --- Audit page (admin only) ---
async function renderWarehouseAudit(container) {
    container.innerHTML = `
        <div class="page-header"><div><h1>${pt('whAuditTitle')}</h1><p>${pt('whAuditDesc')}</p></div></div>
        <div class="page-body"><div class="portal-card"><div class="card-body" id="whAuditTable">
            <div class="empty-state"><div class="spinner"></div></div>
        </div></div></div>`;
    try {
        const res = await apiCall('/api/warehouse/audit');
        const logs = (await res.json()).data || [];
        const tableEl = document.getElementById('whAuditTable');
        if (logs.length === 0) {
            tableEl.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">${pt('whAuditEmpty')}</div></div>`;
            return;
        }
        tableEl.innerHTML = `
            <table class="data-table">
                <thead><tr><th>${pt('whColDate')}</th><th>${pt('whColUser')}</th><th>${pt('whColAction')}</th><th>${pt('whColEntity')}</th><th>${pt('whColDetails')}</th></tr></thead>
                <tbody>
                    ${logs.map(l => `
                        <tr>
                            <td>${formatDate(l.created_at)}</td>
                            <td>${escapeHtml(l.user_name || '-')}</td>
                            <td><span class="badge badge-${l.action}">${l.action}</span></td>
                            <td>${l.entity} #${l.entity_id || '-'}</td>
                            <td><small>${l.details ? escapeHtml(JSON.stringify(l.details).substring(0, 60)) : '-'}</small></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        document.getElementById('whAuditTable').innerHTML = `<div class="empty-state"><div class="empty-text">${pt('pageLoadError')}</div></div>`;
    }
}

// ============================================
// ADMIN - FLEET MANAGEMENT
// ============================================

async function renderAdminFleet(container) {
    const response = await apiCall('/api/fleet');
    const vehicles = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('fleetTitle')}</h1><p>${pt('fleetDesc')}</p></div>
            <button class="btn btn-primary" onclick="openNewVehicleModal()">+ ${pt('fleetAddNew')}</button>
        </div>
        <div class="page-body">
            ${vehicles.length > 0 ? `
                <div class="fleet-grid">
                    ${vehicles.map(v => renderVehicleCard(v)).join('')}
                </div>
            ` : `
                <div class="portal-card">
                    <div class="card-body">
                        <div class="empty-state">
                            <div class="empty-icon">&#128663;</div>
                            <div class="empty-text">${pt('fleetEmpty')}</div>
                        </div>
                    </div>
                </div>
            `}
        </div>
    `;
}

function renderVehicleCard(v) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    function getExpiryInfo(dateStr) {
        if (!dateStr) return { label: pt('fleetNotSet'), cls: 'neutral', days: null };
        const d = new Date(dateStr);
        d.setHours(0, 0, 0, 0);
        const days = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
        const dateOnly = d.toLocaleDateString(portalLang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
        if (days < 0) return { label: dateOnly, cls: 'expired', days };
        if (days <= 7) return { label: dateOnly, cls: 'critical', days };
        if (days <= 14) return { label: dateOnly, cls: 'warning', days };
        if (days <= 30) return { label: dateOnly, cls: 'soon', days };
        return { label: dateOnly, cls: 'ok', days };
    }

    const stk = getExpiryInfo(v.stk_valid_until);
    const ek = getExpiryInfo(v.ek_valid_until);
    const hw = getExpiryInfo(v.highway_sticker_valid_until);

    const emails = (v.notification_email || '').split(',').map(e => e.trim()).filter(Boolean);
    const emailDisplay = emails.length > 1 ? `${emails[0]} (+${emails.length - 1})` : (emails[0] || '-');

    const yearMonth = v.year_manufactured
        ? `${v.year_manufactured}${v.month_manufactured ? ' / ' + v.month_manufactured : ''}`
        : '';

    const plateSvg = `<svg class="eu-plate-svg" viewBox="0 0 3416.51 761.68" xmlns="http://www.w3.org/2000/svg">
        <rect width="3416.51" height="761.68" rx="77.7" ry="77.7" fill="#f6f6f6"/>
        <path d="M3338.47,15.55H78.06c-34.45,0-62.5,28.05-62.5,62.5v605.56c0,34.45,28.05,62.5,62.5,62.5h3260.4c34.45,0,62.5-28.05,62.5-62.5V78.06c0-34.45-28.05-62.5-62.5-62.5ZM3384.75,683.62c0,25.62-20.75,46.29-46.29,46.29H78.06c-25.62,0-46.29-20.67-46.29-46.29V78.06c0-25.62,20.67-46.29,46.29-46.29h3260.4c25.53,0,46.29,20.67,46.29,46.29v605.56Z" fill="#1d1d1b"/>
        <path d="M362.9,31.77v698.14H78.06c-25.62,0-46.29-20.67-46.29-46.29V78.06c0-25.62,20.67-46.29,46.29-46.29h284.84Z" fill="#003caa"/>
        <g fill="#fdcb00">
            <polygon points="197.36 94 200.81 104.47 211.84 104.52 202.95 111.05 206.31 121.55 197.36 115.11 188.41 121.55 191.77 111.05 182.88 104.52 193.9 104.47 197.36 94"/>
            <polygon points="145.46 108.4 148.91 118.87 159.94 118.92 151.05 125.44 154.41 135.95 145.46 129.51 136.51 135.95 139.87 125.44 130.97 118.92 142 118.87 145.46 108.4"/>
            <polygon points="106.79 145.23 110.25 155.7 121.28 155.75 112.38 162.28 115.74 172.78 106.79 166.34 97.84 172.78 101.2 162.28 92.31 155.75 103.34 155.7 106.79 145.23"/>
            <polygon points="91.26 200.1 94.71 210.58 105.74 210.63 96.85 217.15 100.21 227.65 91.26 221.21 82.31 227.65 85.67 217.15 76.77 210.63 87.8 210.58 91.26 200.1"/>
            <polygon points="108.62 250.86 112.08 261.34 123.11 261.39 114.21 267.91 117.57 278.41 108.62 271.97 99.67 278.41 103.03 267.91 94.14 261.39 105.17 261.34 108.62 250.86"/>
            <polygon points="143.63 287.7 147.08 298.17 158.11 298.22 149.22 304.74 152.58 315.24 143.63 308.8 134.68 315.24 138.04 304.74 129.14 298.22 140.17 298.17 143.63 287.7"/>
            <polygon points="197.36 306.2 200.81 316.68 211.84 316.73 202.95 323.25 206.31 333.75 197.36 327.31 188.41 333.75 191.77 323.25 182.88 316.73 193.9 316.68 197.36 306.2"/>
            <polygon points="251.09 287.7 254.54 298.17 265.57 298.22 256.68 304.74 260.04 315.24 251.09 308.8 242.14 315.24 245.5 304.74 236.61 298.22 247.63 298.17 251.09 287.7"/>
            <polygon points="286.09 250.86 289.55 261.34 300.57 261.39 291.68 267.91 295.04 278.41 286.09 271.97 277.14 278.41 280.5 267.91 271.61 261.39 282.64 261.34 286.09 250.86"/>
            <polygon points="303.46 200.1 306.91 210.58 317.94 210.63 309.05 217.15 312.41 227.65 303.46 221.21 294.51 227.65 297.87 217.15 288.98 210.63 300 210.58 303.46 200.1"/>
            <polygon points="287.92 145.23 291.38 155.7 302.4 155.75 293.51 162.28 296.87 172.78 287.92 166.34 278.97 172.78 282.33 162.28 273.44 155.75 284.47 155.7 287.92 145.23"/>
            <polygon points="249.26 108.4 252.71 118.87 263.74 118.92 254.85 125.44 258.21 135.95 249.26 129.51 240.31 135.95 243.67 125.44 234.78 118.92 245.8 118.87 249.26 108.4"/>
        </g>
        <text x="197" y="580" fill="#fff" font-family="Arial, sans-serif" font-size="220" font-weight="700" text-anchor="middle">SK</text>
    </svg>`;

    return `
        <div class="fleet-card ${!v.is_active ? 'inactive' : ''}">
            <div class="fleet-card-top">
                <div class="fleet-badges">
                    <span class="fleet-badge ${v.is_active ? 'active' : 'inactive'}">${v.is_active ? pt('fleetActive') : pt('fleetInactive')}</span>
                    ${v.brand ? `<span class="fleet-badge brand">${escapeHtml(v.brand)}</span>` : ''}
                </div>
                <div class="fleet-card-actions">
                    <button class="fleet-action-btn edit" onclick="editVehicle(${v.id})" title="${pt('edit')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="fleet-action-btn toggle" onclick="toggleVehicleActive(${v.id})" title="${v.is_active ? pt('fleetDeactivate') : pt('fleetActivate')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                    </button>
                    <button class="fleet-action-btn delete" onclick="deleteVehicle(${v.id})" title="${pt('delete')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>

            <h3 class="fleet-card-title">${escapeHtml(v.name)}</h3>

            <div class="fleet-meta">
                ${v.brand ? `<span class="fleet-meta-item">&#128663; ${escapeHtml(v.brand)}</span>` : ''}
                ${v.model ? `<span class="fleet-meta-item">&#128203; ${escapeHtml(v.model)}</span>` : ''}
                ${yearMonth ? `<span class="fleet-meta-item">&#128197; ${yearMonth}</span>` : ''}
            </div>

            <div class="eu-plate-wrapper">
                ${plateSvg}
                <span class="eu-plate-number">${escapeHtml(v.license_plate)}</span>
            </div>

            <div class="fleet-expiry-list">
                <div class="fleet-expiry-row fleet-status-${stk.cls}">
                    <span class="fleet-expiry-label">STK</span>
                    <span class="fleet-expiry-value fleet-status-${stk.cls}">${stk.label}</span>
                </div>
                <div class="fleet-expiry-row fleet-status-${ek.cls}">
                    <span class="fleet-expiry-label">EK</span>
                    <span class="fleet-expiry-value fleet-status-${ek.cls}">${ek.label}</span>
                </div>
                <div class="fleet-expiry-row fleet-status-${hw.cls}">
                    <span class="fleet-expiry-label">${pt('fleetHighwaySticker')}</span>
                    <span class="fleet-expiry-value fleet-status-${hw.cls}">${hw.label}</span>
                </div>
            </div>

            <div class="fleet-card-footer">
                <div class="fleet-contact">
                    <div class="fleet-contact-label">${pt('fleetContactPerson')}</div>
                    <div class="fleet-contact-email">${escapeHtml(emailDisplay)}</div>
                </div>
                <div class="fleet-footer-actions">
                    <button class="fleet-btn primary" onclick="editVehicle(${v.id})">${pt('edit')}</button>
                </div>
            </div>
        </div>
    `;
}

function openNewVehicleModal() {
    document.getElementById('modalTitle').textContent = pt('fleetNewTitle');
    document.getElementById('modalBody').innerHTML = buildVehicleForm();
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitNewVehicle()">${pt('save')}</button>
    `;
    openModal();
}

async function editVehicle(id) {
    const response = await apiCall(`/api/fleet/${id}`);
    const v = (await response.json()).data;
    if (!v) { showToast(pt('fleetNotFound'), 'error'); return; }

    document.getElementById('modalTitle').textContent = pt('fleetEditTitle');
    document.getElementById('modalBody').innerHTML = buildVehicleForm(v);
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="submitEditVehicle(${id})">${pt('save')}</button>
    `;
    openModal();
}

function buildVehicleForm(v = {}) {
    const fmt = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
    const emails = (v.notification_email || '').split(',').map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) emails.push('');
    return `
        <form id="vehicleForm">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('fleetName')} *</label>
                    <input type="text" class="form-input" name="name" value="${escapeHtml(v.name || '')}" required placeholder="${pt('fleetNamePlaceholder')}">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('fleetLicensePlate')} *</label>
                    <input type="text" class="form-input" name="license_plate" value="${escapeHtml(v.license_plate || '')}" required placeholder="BA-123AB" style="text-transform: uppercase;">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('fleetBrand')}</label>
                    <input type="text" class="form-input" name="brand" value="${escapeHtml(v.brand || '')}" placeholder="Škoda">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('fleetModel')}</label>
                    <input type="text" class="form-input" name="model" value="${escapeHtml(v.model || '')}" placeholder="Octavia">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('fleetYearManufactured')}</label>
                    <input type="number" class="form-input" name="year_manufactured" value="${v.year_manufactured || ''}" min="1990" max="2030" placeholder="2022">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('fleetMonthManufactured')}</label>
                    <input type="number" class="form-input" name="month_manufactured" value="${v.month_manufactured || ''}" min="1" max="12" placeholder="6">
                </div>
            </div>

            <div style="margin: 1rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid var(--gray-200, #e5e7eb);">
                <div style="font-weight: 700; font-size: 0.85rem; color: var(--gray-600); margin-bottom: 0.5rem;">&#128203; ${pt('fleetExpiryDates')}</div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">STK ${pt('fleetValidUntil')}</label>
                    <input type="date" class="form-input" name="stk_valid_until" value="${fmt(v.stk_valid_until)}">
                </div>
                <div class="form-group">
                    <label class="form-label">EK ${pt('fleetValidUntil')}</label>
                    <input type="date" class="form-input" name="ek_valid_until" value="${fmt(v.ek_valid_until)}">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${pt('fleetHighwaySticker')} ${pt('fleetValidUntil')}</label>
                <input type="date" class="form-input" name="highway_sticker_valid_until" value="${fmt(v.highway_sticker_valid_until)}">
            </div>

            <div style="margin: 1rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid var(--gray-200, #e5e7eb);">
                <div style="font-weight: 700; font-size: 0.85rem; color: var(--gray-600); margin-bottom: 0.25rem;">&#128231; ${pt('fleetNotificationEmail')} *</div>
                <div style="font-size: 0.75rem; color: var(--gray-500); margin-bottom: 0.5rem;">${pt('fleetNotificationEmailHint')}</div>
            </div>
            <div id="emailList">
                ${emails.map((email, idx) => `
                    <div class="email-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <input type="email" class="form-input fleet-email-input" value="${escapeHtml(email)}" placeholder="email@example.com" style="flex: 1;">
                        <button type="button" class="btn btn-sm btn-danger" onclick="removeFleetEmail(this)" ${emails.length === 1 && idx === 0 ? 'disabled style="opacity:0.4;"' : ''}>&#128465;</button>
                    </div>
                `).join('')}
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addFleetEmail()" style="margin-bottom: 1rem;">+ ${pt('fleetAddEmail')}</button>

            <div class="form-group">
                <label class="form-label">${pt('fleetNotes')}</label>
                <textarea class="form-input" name="notes" rows="2" placeholder="${pt('fleetNotesPlaceholder')}">${escapeHtml(v.notes || '')}</textarea>
            </div>
        </form>
    `;
}

function addFleetEmail() {
    const list = document.getElementById('emailList');
    const row = document.createElement('div');
    row.className = 'email-row';
    row.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
    row.innerHTML = `
        <input type="email" class="form-input fleet-email-input" value="" placeholder="email@example.com" style="flex: 1;">
        <button type="button" class="btn btn-sm btn-danger" onclick="removeFleetEmail(this)">&#128465;</button>
    `;
    list.appendChild(row);
    updateEmailDeleteButtons();
}

function removeFleetEmail(btn) {
    btn.parentElement.remove();
    updateEmailDeleteButtons();
}

function updateEmailDeleteButtons() {
    const rows = document.querySelectorAll('#emailList .email-row');
    rows.forEach((row, idx) => {
        const btn = row.querySelector('button');
        if (rows.length === 1) {
            btn.disabled = true;
            btn.style.opacity = '0.4';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    });
}

function getVehicleFormData() {
    const f = document.getElementById('vehicleForm');
    const emailInputs = document.querySelectorAll('.fleet-email-input');
    const emails = Array.from(emailInputs).map(inp => inp.value.trim()).filter(Boolean).join(', ');
    return {
        name: f.name.value.trim(),
        license_plate: f.license_plate.value.trim().toUpperCase(),
        brand: f.brand.value.trim() || null,
        model: f.model.value.trim() || null,
        year_manufactured: f.year_manufactured.value ? parseInt(f.year_manufactured.value) : null,
        month_manufactured: f.month_manufactured.value ? parseInt(f.month_manufactured.value) : null,
        stk_valid_until: f.stk_valid_until.value || null,
        ek_valid_until: f.ek_valid_until.value || null,
        highway_sticker_valid_until: f.highway_sticker_valid_until.value || null,
        notification_email: emails,
        notes: f.notes.value.trim() || null
    };
}

async function submitNewVehicle() {
    const data = getVehicleFormData();
    if (!data.name || !data.license_plate || !data.notification_email) {
        showToast(pt('fleetRequiredFields'), 'error'); return;
    }
    try {
        const response = await apiCall('/api/fleet', { method: 'POST', body: JSON.stringify(data) });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || pt('saveFailed')); }
        showToast(pt('fleetCreated'), 'success');
        closeModal();
        navigateToPage('admin-fleet');
    } catch (error) { showToast(error.message, 'error'); }
}

async function submitEditVehicle(id) {
    const data = getVehicleFormData();
    if (!data.name || !data.license_plate || !data.notification_email) {
        showToast(pt('fleetRequiredFields'), 'error'); return;
    }
    try {
        const response = await apiCall(`/api/fleet/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || pt('saveFailed')); }
        showToast(pt('fleetUpdated'), 'success');
        closeModal();
        navigateToPage('admin-fleet');
    } catch (error) { showToast(error.message, 'error'); }
}

async function toggleVehicleActive(id) {
    try {
        const response = await apiCall(`/api/fleet/${id}/toggle`, { method: 'PATCH' });
        if (!response.ok) throw new Error(pt('changeFailed'));
        navigateToPage('admin-fleet');
    } catch (error) { showToast(error.message, 'error'); }
}

async function deleteVehicle(id) {
    if (!confirm(pt('fleetDeleteConfirm'))) return;
    try {
        const response = await apiCall(`/api/fleet/${id}`, { method: 'DELETE' });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || pt('deleteFailed')); }
        showToast(pt('fleetDeleted'), 'success');
        navigateToPage('admin-fleet');
    } catch (error) { showToast(error.message, 'error'); }
}

// Toast
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '&#9989;' : '&#9888;'}</span>
        <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
