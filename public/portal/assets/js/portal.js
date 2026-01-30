/**
 * ETILOG Portal - Single Page Application
 * Handles routing, page rendering, and all portal functionality
 */

let portalUser = null;
let currentPage = 'dashboard';

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    if (!isLoggedIn()) {
        window.location.href = '/login';
        return;
    }

    const profileLoaded = await loadUserProfile();
    if (!profileLoaded) {
        // Don't redirect in loop - show error state
        document.getElementById('pageLoading').style.display = 'none';
        document.getElementById('pageContent').innerHTML = `
            <div class="page-body">
                <div class="empty-state">
                    <div class="empty-icon">&#9888;</div>
                    <div class="empty-text">Nepodarilo sa načítať profil. Skúste sa znovu prihlásiť.</div>
                    <br><button class="btn btn-primary" onclick="handleLogout()">Odhlásiť sa a skúsiť znova</button>
                </div>
            </div>`;
        return;
    }

    setupNavigation();
    navigateToPage(window.location.hash.slice(1) || 'dashboard');
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

        // Store user
        localStorage.setItem('etilog_user', JSON.stringify(portalUser));

        // Update sidebar
        document.getElementById('userName').textContent = portalUser.name || portalUser.email;
        document.getElementById('userRoleBadge').textContent = portalUser.role;
        document.getElementById('userAvatar').textContent = getInitials(portalUser.name || portalUser.email);

        // Show admin nav if admin
        if (portalUser.role === 'admin') {
            document.getElementById('adminNav').style.display = 'block';
        }
        return true;
    } catch (error) {
        console.error('Failed to load profile:', error);
        showToast('Nepodarilo sa načítať profil: ' + error.message, 'error');
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
        navigateToPage(window.location.hash.slice(1) || 'dashboard');
    });
}

function navigateToPage(page) {
    if (!page) page = 'dashboard';

    // Check admin access
    if (page.startsWith('admin-') && portalUser?.role !== 'admin') {
        showToast('Prístup zamietnutý', 'error');
        return;
    }

    currentPage = page;
    window.location.hash = page;

    // Update active nav
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');

    // Close mobile sidebar
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
            case 'dashboard': await renderDashboard(content); break;
            case 'my-quotas': await renderMyQuotas(content); break;
            case 'my-sick-notes': await renderMySickNotes(content); break;
            case 'my-requests': await renderMyRequests(content); break;
            case 'admin-dashboard': await renderAdminDashboard(content); break;
            case 'admin-employees': await renderAdminEmployees(content); break;
            case 'admin-quotas': await renderAdminQuotas(content); break;
            case 'admin-sick-notes': await renderAdminSickNotes(content); break;
            case 'admin-tickets': await renderAdminTickets(content); break;
            default: content.innerHTML = '<div class="page-body"><div class="empty-state"><div class="empty-icon">&#128533;</div><div class="empty-text">Stránka sa nenašla</div></div></div>';
        }
    } catch (error) {
        console.error('Page render error:', error);
        content.innerHTML = `<div class="page-body"><div class="empty-state"><div class="empty-icon">&#9888;</div><div class="empty-text">Chyba pri načítaní stránky: ${error.message}</div></div></div>`;
    }

    loading.style.display = 'none';
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
    const sickUsedPct = quota ? Math.round((parseFloat(quota.sick_days_used) / quota.sick_days_total) * 100) : 0;

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Dashboard</h1><p>Vitajte, ${portalUser.name || portalUser.email}</p></div>
        </div>
        <div class="page-body">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">&#128197;</div>
                    <div><div class="stat-value">${quota ? quota.vacation_days_remaining : '-'}</div><div class="stat-label">Zostatok dovolenky</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon amber">&#129298;</div>
                    <div><div class="stat-value">${quota ? quota.sick_days_remaining : '-'}</div><div class="stat-label">Zostatok zdravotného voľna</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">&#9989;</div>
                    <div><div class="stat-value">${approved}</div><div class="stat-label">Schválené žiadosti</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">&#9203;</div>
                    <div><div class="stat-value">${pending}</div><div class="stat-label">Čakajúce žiadosti</div></div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>Moje kvoty ${year}</h2>
                </div>
                <div class="card-body">
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>Dovolenka</span>
                            <span>${quota ? parseFloat(quota.vacation_days_used) : 0} / ${quota ? quota.vacation_days_total : 20} dní</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${vacUsedPct > 90 ? 'red' : vacUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(vacUsedPct, 100)}%"></div>
                        </div>
                    </div>
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>Zdravotné voľno</span>
                            <span>${quota ? parseFloat(quota.sick_days_used) : 0} / ${quota ? quota.sick_days_total : 5} dní</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${sickUsedPct > 90 ? 'red' : sickUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(sickUsedPct, 100)}%"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>Posledné žiadosti</h2>
                </div>
                <div class="card-body">
                    ${tickets.length > 0 ? `
                        <table class="data-table">
                            <thead>
                                <tr><th>Názov</th><th>Typ</th><th>Status</th><th>Dátum</th></tr>
                            </thead>
                            <tbody>
                                ${tickets.slice(0, 10).map(t => `
                                    <tr>
                                        <td>${escapeHtml(t.title)}</td>
                                        <td><span class="badge badge-${t.ticket_type === 'vacation' ? 'vacation' : t.ticket_type === 'sick-leave' ? 'sick' : 'user'}">${t.ticket_type}</span></td>
                                        <td><span class="badge badge-${t.status.toLowerCase()}">${t.status}</span></td>
                                        <td>${formatDate(t.created_at)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">Žiadne žiadosti</div></div>'}
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
    const sickUsedPct = quota ? Math.round((parseFloat(quota.sick_days_used) / quota.sick_days_total) * 100) : 0;

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Moje kvoty</h1><p>Prehľad dovolenky a sick days pre rok ${year}</p></div>
        </div>
        <div class="page-body">
            <div class="quota-card">
                <div class="quota-icon">&#127796;</div>
                <div class="quota-details">
                    <div class="quota-type">Dovolenka</div>
                    <div class="quota-numbers">
                        <span>Celkom: <strong>${quota ? quota.vacation_days_total : '-'} dni</strong></span>
                        <span>Využité: <strong>${quota ? parseFloat(quota.vacation_days_used) : 0} dni</strong></span>
                        <span>Zostatok: <strong>${quota ? quota.vacation_days_remaining : '-'} dni</strong></span>
                    </div>
                    <div class="quota-bar" style="margin-top: 0.75rem;">
                        <div class="quota-bar-fill ${vacUsedPct > 90 ? 'red' : vacUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(vacUsedPct, 100)}%"></div>
                    </div>
                </div>
            </div>

            <div class="quota-card">
                <div class="quota-icon">&#129298;</div>
                <div class="quota-details">
                    <div class="quota-type">Zdravotné voľno</div>
                    <div class="quota-numbers">
                        <span>Celkom: <strong>${quota ? quota.sick_days_total : '-'} dni</strong></span>
                        <span>Využité: <strong>${quota ? parseFloat(quota.sick_days_used) : 0} dni</strong></span>
                        <span>Zostatok: <strong>${quota ? quota.sick_days_remaining : '-'} dni</strong></span>
                    </div>
                    <div class="quota-bar" style="margin-top: 0.75rem;">
                        <div class="quota-bar-fill ${sickUsedPct > 90 ? 'red' : sickUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(sickUsedPct, 100)}%"></div>
                    </div>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>Sviatky SR ${year}</h2>
                </div>
                <div class="card-body">
                    <table class="data-table">
                        <thead><tr><th>Dátum</th><th>Názov</th></tr></thead>
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
            <div><h1>Moje PN-ky</h1><p>Evidencia práceneschopností</p></div>
            <button class="btn btn-primary" onclick="openNewSickNoteModal()">+ Nová PN-ka</button>
        </div>
        <div class="page-body">
            ${notes.length > 0 ? `
                <table class="data-table">
                    <thead>
                        <tr><th>Názov</th><th>Dátum od</th><th>Dátum do</th><th>Lekár</th><th>Súbor</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                        ${notes.map(n => `
                            <tr>
                                <td><strong>${escapeHtml(n.title)}</strong>${n.diagnosis ? `<br><small style="color:var(--gray-500)">${escapeHtml(n.diagnosis)}</small>` : ''}</td>
                                <td>${formatDate(n.start_date)}</td>
                                <td>${formatDate(n.end_date)}</td>
                                <td>${n.doctor_name ? escapeHtml(n.doctor_name) : '-'}</td>
                                <td>${n.file_name ? `<a href="#" onclick="downloadSickNoteFile(${n.id})" style="color:var(--blue-600)">${escapeHtml(n.file_name)}</a>` : '<span style="color:var(--gray-400)">Žiadny</span>'}</td>
                                <td><span class="badge badge-${n.status}">${n.status}</span></td>
                                <td>
                                    <button class="btn btn-ghost btn-sm" onclick="openUploadSickNoteModal(${n.id})">&#128206;</button>
                                    <button class="btn btn-ghost btn-sm" onclick="deleteSickNote(${n.id})" style="color:var(--red-500)">&#128465;</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">Žiadne PN-ky</div></div>'}
        </div>
    `;
}

async function openNewSickNoteModal() {
    document.getElementById('modalTitle').textContent = 'Nová PN-ka';
    document.getElementById('modalBody').innerHTML = `
        <form id="sickNoteForm">
            <div class="form-group">
                <label class="form-label">Názov *</label>
                <input type="text" class="form-input" name="title" required placeholder="napr. PN - chrípka">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Dátum od *</label>
                    <input type="date" class="form-input" name="start_date" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Dátum do *</label>
                    <input type="date" class="form-input" name="end_date" required>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Meno lekára</label>
                <input type="text" class="form-input" name="doctor_name" placeholder="MUDr. ...">
            </div>
            <div class="form-group">
                <label class="form-label">Diagnóza</label>
                <input type="text" class="form-input" name="diagnosis" placeholder="Voliteľné">
            </div>
            <div class="form-group">
                <label class="form-label">Popis</label>
                <textarea class="form-textarea" name="description" rows="3" placeholder="Doplňujúce informácie..."></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Súbor (PDF, JPG, PNG - max 10MB)</label>
                <input type="file" class="form-input" name="file" accept=".pdf,.jpg,.jpeg,.png">
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Zrušiť</button>
        <button class="btn btn-primary" onclick="submitSickNote()">Uložiť</button>
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

        showToast('PN-ka bola vytvorená', 'success');
        closeModal();
        navigateToPage('my-sick-notes');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

async function openUploadSickNoteModal(id) {
    document.getElementById('modalTitle').textContent = 'Nahrať súbor k PN-ke';
    document.getElementById('modalBody').innerHTML = `
        <form id="uploadForm">
            <div class="form-group">
                <label class="form-label">Súbor (PDF, JPG, PNG - max 10MB)</label>
                <div class="file-upload-area" onclick="document.getElementById('uploadFile').click()">
                    <div class="file-upload-icon">&#128206;</div>
                    <div class="file-upload-text">Kliknite pre výber súboru alebo ho sem pretiahnite<br><strong>PDF, JPG, PNG</strong> do 10MB</div>
                </div>
                <input type="file" id="uploadFile" name="file" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="showFilePreview(this)">
                <div id="filePreview"></div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Zrušiť</button>
        <button class="btn btn-primary" onclick="uploadSickNoteFile(${id})">Nahrať</button>
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
        showToast('Vyberte súbor', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const response = await apiCall(`/api/sick-notes/${id}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Upload zlyhal');

        showToast('Súbor bol nahraný', 'success');
        closeModal();
        navigateToPage('my-sick-notes');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

async function downloadSickNoteFile(id) {
    try {
        const response = await apiCall(`/api/sick-notes/${id}/file`);
        if (!response.ok) throw new Error('Súbor sa nenašiel');

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
        showToast('Chyba pri sťahovaní: ' + error.message, 'error');
    }
}

async function deleteSickNote(id) {
    if (!confirm('Naozaj chcete vymazať túto PN-ku?')) return;

    try {
        const response = await apiCall(`/api/sick-notes/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Vymazanie zlyhalo');

        showToast('PN-ka bola vymazaná', 'success');
        navigateToPage('my-sick-notes');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

// ============================================
// MY REQUESTS
// ============================================

async function renderMyRequests(container) {
    const response = await apiCall(`/api/tickets?createdById=${portalUser.id}`);
    const tickets = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Moje žiadosti</h1><p>Všetky moje tikety a schvaľovanie</p></div>
        </div>
        <div class="page-body">
            <div class="filters-bar">
                <select class="form-select" onchange="filterMyRequests(this.value)" id="myReqFilter">
                    <option value="">Všetky statusy</option>
                    <option value="Pending">Čakajúce</option>
                    <option value="Approved">Schválené</option>
                    <option value="Rejected">Zamietnuté</option>
                </select>
            </div>
            <div id="myRequestsList">
                ${renderTicketsTable(tickets)}
            </div>
        </div>
    `;
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
            <div><h1>Admin Dashboard</h1><p>Prehľad systému pre rok ${year}</p></div>
        </div>
        <div class="page-body">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">&#128101;</div>
                    <div><div class="stat-value">${stats.totalUsers}</div><div class="stat-label">Zamestnancov</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon amber">&#9203;</div>
                    <div><div class="stat-value">${stats.tickets.pending}</div><div class="stat-label">Čakajúce tikety</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">&#9989;</div>
                    <div><div class="stat-value">${stats.tickets.approved}</div><div class="stat-label">Schválené tikety</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">&#10060;</div>
                    <div><div class="stat-value">${stats.tickets.rejected}</div><div class="stat-label">Zamietnuté tikety</div></div>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon green">&#127796;</div>
                    <div><div class="stat-value">${stats.tickets.approved_vacations}</div><div class="stat-label">Schválené dovolenky</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon amber">&#129298;</div>
                    <div><div class="stat-value">${stats.tickets.approved_sick_leaves}</div><div class="stat-label">Schválené PN-ky</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon blue">&#128203;</div>
                    <div><div class="stat-value">${stats.sickNotes.total_sick_notes}</div><div class="stat-label">PN-ky celkom</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">&#128196;</div>
                    <div><div class="stat-value">${stats.tickets.total}</div><div class="stat-label">Tikety celkom</div></div>
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
    const response = await apiCall(`/api/admin/employees?year=${year}`);
    const employees = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Zamestnanci</h1><p>Správa rolí a kvót zamestnancov</p></div>
            <button class="btn btn-primary" onclick="initializeAllQuotas()">Inicializovať kvóty ${year}</button>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr><th>Meno</th><th>Email</th><th>Rola</th><th>Dovolenka</th><th>Zdrav. voľno</th><th>Akcie</th></tr>
                        </thead>
                        <tbody>
                            ${employees.map(e => `
                                <tr>
                                    <td><strong>${escapeHtml(e.name)}</strong></td>
                                    <td>${escapeHtml(e.email)}</td>
                                    <td><span class="badge badge-${e.role}">${e.role}</span></td>
                                    <td>${e.vacation_days_total !== null ? `${e.vacation_days_used}/${e.vacation_days_total}` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                    <td>${e.sick_days_total !== null ? `${e.sick_days_used}/${e.sick_days_total}` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                    <td>
                                        <button class="btn btn-ghost btn-sm" onclick="toggleEmployeeRole('${e.id}', '${e.role}')" title="Zmeniť rolu">${e.role === 'admin' ? '&#128100;' : '&#128081;'}</button>
                                        <button class="btn btn-ghost btn-sm" onclick="editEmployeeQuota('${e.id}', '${escapeHtml(e.name)}', ${e.vacation_days_total || 20}, ${e.sick_days_total || 5})" title="Upraviť kvótu">&#9999;</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

async function toggleEmployeeRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!confirm(`Zmeniť rolu na "${newRole}"?`)) return;

    try {
        const response = await apiCall(`/api/admin/employees/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: newRole })
        });
        if (!response.ok) throw new Error('Zmena zlyhala');
        showToast(`Rola zmenená na ${newRole}`, 'success');
        navigateToPage('admin-employees');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

async function editEmployeeQuota(userId, name, vacTotal, sickTotal) {
    const year = new Date().getFullYear();
    document.getElementById('modalTitle').textContent = `Kvoty - ${name}`;
    document.getElementById('modalBody').innerHTML = `
        <form id="quotaForm">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Dovolenka (dni)</label>
                    <input type="number" class="form-input" name="vacation_days_total" value="${vacTotal}" min="0" max="50">
                </div>
                <div class="form-group">
                    <label class="form-label">Zdravotné voľno (dni)</label>
                    <input type="number" class="form-input" name="sick_days_total" value="${sickTotal}" min="0" max="30">
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Zrušiť</button>
        <button class="btn btn-primary" onclick="saveEmployeeQuota('${userId}', ${year})">Uložiť</button>
    `;
    openModal();
}

async function saveEmployeeQuota(userId, year) {
    const form = document.getElementById('quotaForm');
    const data = {
        year,
        vacation_days_total: parseInt(form.vacation_days_total.value),
        sick_days_total: parseInt(form.sick_days_total.value)
    };

    try {
        const response = await apiCall(`/api/quotas/user/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Uloženie zlyhalo');
        showToast('Kvóta uložená', 'success');
        closeModal();
        navigateToPage('admin-employees');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

async function initializeAllQuotas() {
    const year = new Date().getFullYear();
    if (!confirm(`Inicializovať kvóty pre všetkých zamestnancov na rok ${year}?`)) return;

    try {
        const response = await apiCall('/api/quotas/initialize', {
            method: 'POST',
            body: JSON.stringify({ year })
        });
        const result = await response.json();
        showToast(`Inicializované pre ${result.count} zamestnancov`, 'success');
        navigateToPage('admin-employees');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

// ============================================
// ADMIN QUOTAS
// ============================================

async function renderAdminQuotas(container) {
    const year = new Date().getFullYear();
    const [quotasRes, settingsRes] = await Promise.all([
        apiCall(`/api/quotas/all?year=${year}`),
        apiCall('/api/quotas/settings')
    ]);

    const quotas = (await quotasRes.json()).data || [];
    const settings = (await settingsRes.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Kvoty</h1><p>Prehľad kvót všetkých zamestnancov</p></div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-header">
                    <h2>Nastavenia kvót</h2>
                    <button class="btn btn-sm btn-secondary" onclick="openQuotaSettingsModal()">Upraviť</button>
                </div>
                <div class="card-body">
                    <table class="data-table">
                        <thead><tr><th>Rok</th><th>Predvolená dovolenka</th><th>Predvolené zdrav. voľno</th><th>Prenos zostatku</th></tr></thead>
                        <tbody>
                            ${settings.map(s => `
                                <tr>
                                    <td><strong>${s.year}</strong></td>
                                    <td>${s.default_vacation_days} dni</td>
                                    <td>${s.default_sick_days} dni</td>
                                    <td>${s.carry_over_enabled ? `Ano (max ${s.max_carry_over_days} dni)` : 'Nie'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>Kvoty zamestnancov ${year}</h2>
                </div>
                <div class="card-body" style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr><th>Zamestnanec</th><th>Dovolenka celkom</th><th>Dovolenka využitá</th><th>Zostatok</th><th>Zdrav. voľno celkom</th><th>Zdrav. voľno využité</th><th>Zostatok</th></tr>
                        </thead>
                        <tbody>
                            ${quotas.map(q => `
                                <tr>
                                    <td><strong>${escapeHtml(q.display_name || 'N/A')}</strong><br><small style="color:var(--gray-500)">${escapeHtml(q.email || '')}</small></td>
                                    <td>${q.vacation_days_total}</td>
                                    <td>${q.vacation_days_used}</td>
                                    <td><strong style="color:${q.vacation_days_remaining <= 2 ? 'var(--red-500)' : 'var(--green-600)'}">${q.vacation_days_remaining}</strong></td>
                                    <td>${q.sick_days_total}</td>
                                    <td>${q.sick_days_used}</td>
                                    <td><strong style="color:${q.sick_days_remaining <= 1 ? 'var(--red-500)' : 'var(--green-600)'}">${q.sick_days_remaining}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

async function openQuotaSettingsModal() {
    const year = new Date().getFullYear();
    document.getElementById('modalTitle').textContent = 'Nastavenia kvót';
    document.getElementById('modalBody').innerHTML = `
        <form id="quotaSettingsForm">
            <div class="form-group">
                <label class="form-label">Rok</label>
                <input type="number" class="form-input" name="year" value="${year}" min="2024" max="2030">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Predvolená dovolenka (dni)</label>
                    <input type="number" class="form-input" name="default_vacation_days" value="20" min="0" max="50">
                </div>
                <div class="form-group">
                    <label class="form-label">Predvolené zdrav. voľno</label>
                    <input type="number" class="form-input" name="default_sick_days" value="5" min="0" max="30">
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Zrušiť</button>
        <button class="btn btn-primary" onclick="saveQuotaSettings()">Uložiť</button>
    `;
    openModal();
}

async function saveQuotaSettings() {
    const form = document.getElementById('quotaSettingsForm');
    const data = {
        year: parseInt(form.year.value),
        default_vacation_days: parseInt(form.default_vacation_days.value),
        default_sick_days: parseInt(form.default_sick_days.value)
    };

    try {
        const response = await apiCall('/api/quotas/settings', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Uloženie zlyhalo');
        showToast('Nastavenia uložené', 'success');
        closeModal();
        navigateToPage('admin-quotas');
    } catch (error) {
        showToast('Chyba: ' + error.message, 'error');
    }
}

// ============================================
// ADMIN SICK NOTES
// ============================================

async function renderAdminSickNotes(container) {
    const year = new Date().getFullYear();
    const response = await apiCall(`/api/sick-notes/all?year=${year}`);
    const notes = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Všetky PN-ky</h1><p>Evidencia PN-iek všetkých zamestnancov</p></div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    ${notes.length > 0 ? `
                        <table class="data-table">
                            <thead>
                                <tr><th>Zamestnanec</th><th>Názov</th><th>Dátum od</th><th>Dátum do</th><th>Lekár</th><th>Súbor</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                                ${notes.map(n => `
                                    <tr>
                                        <td><strong>${escapeHtml(n.user_name)}</strong><br><small style="color:var(--gray-500)">${escapeHtml(n.user_email)}</small></td>
                                        <td>${escapeHtml(n.title)}${n.diagnosis ? `<br><small style="color:var(--gray-500)">${escapeHtml(n.diagnosis)}</small>` : ''}</td>
                                        <td>${formatDate(n.start_date)}</td>
                                        <td>${formatDate(n.end_date)}</td>
                                        <td>${n.doctor_name ? escapeHtml(n.doctor_name) : '-'}</td>
                                        <td>${n.file_name ? `<a href="#" onclick="downloadSickNoteFile(${n.id})" style="color:var(--blue-600)">${escapeHtml(n.file_name)}</a>` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                        <td><span class="badge badge-${n.status}">${n.status}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    ` : '<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">Žiadne PN-ky</div></div>'}
                </div>
            </div>
        </div>
    `;
}

// ============================================
// ADMIN ALL TICKETS
// ============================================

async function renderAdminTickets(container) {
    const year = new Date().getFullYear();
    const response = await apiCall(`/api/admin/tickets?year=${year}`);
    const tickets = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>Všetky tikety</h1><p>Prehľad všetkých tiketov v systéme (${year})</p></div>
        </div>
        <div class="page-body">
            <div class="filters-bar">
                <select class="form-select" id="adminTicketStatus" onchange="filterAdminTickets()">
                    <option value="">Všetky statusy</option>
                    <option value="Pending">Čakajúce</option>
                    <option value="Approved">Schválené</option>
                    <option value="Rejected">Zamietnuté</option>
                </select>
                <select class="form-select" id="adminTicketType" onchange="filterAdminTickets()">
                    <option value="">Všetky typy</option>
                    <option value="vacation">Dovolenka</option>
                    <option value="sick-leave">PN / Práceneschopnosť</option>
                    <option value="purchase">Nákup</option>
                    <option value="expense">Výdavok</option>
                    <option value="hr">HR</option>
                    <option value="other">Iné</option>
                </select>
            </div>
            <div id="adminTicketsList" class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    ${renderAdminTicketsTable(tickets)}
                </div>
            </div>
        </div>
    `;

    // Store tickets for filtering
    window._adminTickets = tickets;
}

function filterAdminTickets() {
    const status = document.getElementById('adminTicketStatus').value;
    const type = document.getElementById('adminTicketType').value;
    let filtered = window._adminTickets || [];
    if (status) filtered = filtered.filter(t => t.status === status);
    if (type) filtered = filtered.filter(t => t.ticket_type === type);
    document.querySelector('#adminTicketsList .card-body').innerHTML = renderAdminTicketsTable(filtered);
}

function renderAdminTicketsTable(tickets) {
    if (!tickets.length) return '<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">Žiadne tikety</div></div>';
    return `
        <table class="data-table">
            <thead>
                <tr><th>ID</th><th>Názov</th><th>Typ</th><th>Vytvoril</th><th>Schvaľovateľ</th><th>Status</th><th>Dátum</th></tr>
            </thead>
            <tbody>
                ${tickets.map(t => `
                    <tr>
                        <td><code>${t.ticket_id}</code></td>
                        <td>${escapeHtml(t.title)}</td>
                        <td><span class="badge badge-${t.ticket_type === 'vacation' ? 'vacation' : t.ticket_type === 'sick-leave' ? 'sick' : 'user'}">${t.ticket_type}</span></td>
                        <td>${escapeHtml(t.created_by_name)}</td>
                        <td>${t.assigned_approver_name ? escapeHtml(t.assigned_approver_name) : '-'}</td>
                        <td><span class="badge badge-${t.status.toLowerCase()}">${t.status}</span></td>
                        <td>${formatDate(t.created_at)}${t.start_date ? `<br><small>${formatDate(t.start_date)} - ${formatDate(t.end_date)}</small>` : ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ============================================
// HELPERS
// ============================================

function renderTicketsTable(tickets) {
    if (!tickets.length) return '<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">Žiadne tikety</div></div>';
    return `
        <div class="portal-card">
            <div class="card-body" style="overflow-x:auto;">
                <table class="data-table">
                    <thead>
                        <tr><th>Názov</th><th>Typ</th><th>Schvaľovateľ</th><th>Status</th><th>Dátum</th></tr>
                    </thead>
                    <tbody>
                        ${tickets.map(t => `
                            <tr>
                                <td><strong>${escapeHtml(t.title)}</strong>${t.rejection_reason ? `<br><small style="color:var(--red-500)">Dôvod: ${escapeHtml(t.rejection_reason)}</small>` : ''}</td>
                                <td><span class="badge badge-${t.ticket_type === 'vacation' ? 'vacation' : t.ticket_type === 'sick-leave' ? 'sick' : 'user'}">${t.ticket_type}</span></td>
                                <td>${t.assigned_approver_name ? escapeHtml(t.assigned_approver_name) : '-'}</td>
                                <td><span class="badge badge-${t.status.toLowerCase()}">${t.status}</span></td>
                                <td>${formatDate(t.created_at)}${t.start_date ? `<br><small>${formatDate(t.start_date)} - ${formatDate(t.end_date)}</small>` : ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
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

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modalOverlay').classList.remove('active');
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
