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

        localStorage.setItem('etilog_user', JSON.stringify(portalUser));

        document.getElementById('userName').textContent = portalUser.name || portalUser.email;
        document.getElementById('userRoleBadge').textContent = portalUser.role;
        document.getElementById('userAvatar').textContent = getInitials(portalUser.name || portalUser.email);

        if (portalUser.role === 'admin') {
            document.getElementById('adminNav').style.display = 'block';
        }
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
        navigateToPage(window.location.hash.slice(1) || 'dashboard');
    });
}

function navigateToPage(page) {
    if (!page) page = 'dashboard';

    if (page.startsWith('admin-') && portalUser?.role !== 'admin') {
        showToast(pt('accessDenied'), 'error');
        return;
    }

    currentPage = page;
    window.location.hash = page;

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
            default: content.innerHTML = `<div class="page-body"><div class="empty-state"><div class="empty-icon">&#128533;</div><div class="empty-text">${pt('pageNotFound')}</div></div></div>`;
        }
    } catch (error) {
        console.error('Page render error:', error);
        content.innerHTML = `<div class="page-body"><div class="empty-state"><div class="empty-icon">&#9888;</div><div class="empty-text">${pt('pageLoadError')}: ${error.message}</div></div></div>`;
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
                    <div><div class="stat-value">${quota ? quota.paragraph_days_remaining : '-'}</div><div class="stat-label">${pt('paragraphRemaining')}</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background:#fef3c7;color:#d97706;">&#128106;</div>
                    <div><div class="stat-value">${quota ? quota.ocr_days_remaining : '-'}</div><div class="stat-label">${pt('ocrRemaining')}</div></div>
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
                            <span>${quota ? parseFloat(quota.vacation_days_used) : 0} / ${quota ? quota.vacation_days_total : 20} ${pt('days')}</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${vacUsedPct > 90 ? 'red' : vacUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(vacUsedPct, 100)}%"></div>
                        </div>
                    </div>
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>${pt('sickNoteDocTypeParagraph') || 'Paragraf'}</span>
                            <span>${quota ? parseFloat(quota.paragraph_days_used || 0) : 0} / ${quota ? (quota.paragraph_days_total || 7) : 7} ${pt('days')}</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${parUsedPct > 90 ? 'red' : parUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(parUsedPct, 100)}%"></div>
                        </div>
                    </div>
                    <div class="quota-bar-container">
                        <div class="quota-bar-label">
                            <span>${pt('sickNoteDocTypeOcr') || 'OČR'}</span>
                            <span>${quota ? parseFloat(quota.ocr_days_used || 0) : 0} / ${quota ? (quota.ocr_days_total || 7) : 7} ${pt('days')}</span>
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
                        <span>${pt('quotaTotal')}: <strong>${quota ? quota.vacation_days_total : '-'} ${pt('days')}</strong></span>
                        <span>${pt('quotaUsed')}: <strong>${quota ? parseFloat(quota.vacation_days_used) : 0} ${pt('days')}</strong></span>
                        <span>${pt('quotaRemaining')}: <strong>${quota ? quota.vacation_days_remaining : '-'} ${pt('days')}</strong></span>
                    </div>
                    <div class="quota-bar" style="margin-top: 0.75rem;">
                        <div class="quota-bar-fill ${vacUsedPct > 90 ? 'red' : vacUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(vacUsedPct, 100)}%"></div>
                    </div>
                </div>
            </div>

            <div class="quota-card">
                <div class="quota-icon" style="font-size:1.5rem;">&#167;</div>
                <div class="quota-details">
                    <div class="quota-type">${pt('sickNoteDocTypeParagraph') || 'Paragraf'}</div>
                    <div class="quota-numbers">
                        <span>${pt('quotaTotal')}: <strong>${quota ? (quota.paragraph_days_total || 7) : '-'} ${pt('days')}</strong></span>
                        <span>${pt('quotaUsed')}: <strong>${quota ? parseFloat(quota.paragraph_days_used || 0) : 0} ${pt('days')}</strong></span>
                        <span>${pt('quotaRemaining')}: <strong>${quota ? quota.paragraph_days_remaining : '-'} ${pt('days')}</strong></span>
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
                        <span>${pt('quotaTotal')}: <strong>${quota ? (quota.ocr_days_total || 7) : '-'} ${pt('days')}</strong></span>
                        <span>${pt('quotaUsed')}: <strong>${quota ? parseFloat(quota.ocr_days_used || 0) : 0} ${pt('days')}</strong></span>
                        <span>${pt('quotaRemaining')}: <strong>${quota ? quota.ocr_days_remaining : '-'} ${pt('days')}</strong></span>
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
    // Load ticket types and users for approver dropdown
    let users = [];
    window._loadedTicketTypes = [];
    try {
        const [typesRes, usersRes] = await Promise.all([
            apiCall('/api/ticket-types/active'),
            apiCall('/api/admin/employees')
        ]);
        window._loadedTicketTypes = (await typesRes.json()).data || [];
        users = (await usersRes.json()).data || [];
    } catch (e) {
        console.error('Error loading form data:', e);
    }

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
                    <input type="date" class="form-input" name="start_date">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('reqFieldEndDate')}</label>
                    <input type="date" class="form-input" name="end_date">
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
    if (row) {
        const types = window._loadedTicketTypes || [];
        const matched = types.find(t => t.key === type);
        const showDates = matched ? matched.requires_dates : false;
        row.style.display = showDates ? 'grid' : 'none';
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
    const response = await apiCall(`/api/admin/employees?year=${year}`);
    const employees = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('employeesTitle')}</h1><p>${pt('employeesDesc')}</p></div>
            <button class="btn btn-primary" onclick="initializeAllQuotas()">${pt('initQuotas')} ${year}</button>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr><th>${pt('colName')}</th><th>${pt('colEmail')}</th><th>${pt('colRole')}</th><th>${pt('colVisibility')}</th><th>${pt('colVacation')}</th><th>${pt('colParagraph')}</th><th>${pt('colOcr')}</th><th>${pt('colActions')}</th></tr>
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
                                    <td>
                                        <div class="table-actions">
                                            <button class="btn-icon" onclick="toggleEmployeeVisibility('${e.id}', ${e.hidden})" title="${e.hidden ? pt('showUserTitle') : pt('hideUserTitle')}">${e.hidden ? '&#128065;' : '&#128683;'}</button>
                                            <button class="btn-icon" onclick="toggleEmployeeRole('${e.id}', '${e.role}')" title="${pt('changeRoleTitle')}">${e.role === 'admin' ? '&#128100;' : '&#128081;'}</button>
                                        </div>
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

async function toggleEmployeeRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!confirm(`${pt('changeRoleConfirm')} "${newRole}"?`)) return;

    try {
        const response = await apiCall(`/api/admin/employees/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: newRole })
        });
        if (!response.ok) throw new Error(pt('changeFailed'));
        showToast(`${pt('roleChanged')} ${newRole}`, 'success');
        navigateToPage('admin-employees');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function initializeAllQuotas() {
    const year = new Date().getFullYear();
    if (!confirm(`${pt('quotasInitConfirm')} ${year}?`)) return;

    try {
        const response = await apiCall('/api/quotas/initialize', {
            method: 'POST',
            body: JSON.stringify({ year })
        });
        const result = await response.json();
        if (result.count > 0) {
            showToast(`${pt('quotasInitialized')} ${result.count} ${pt('employees')}`, 'success');
        } else {
            showToast(pt('quotasAllAlreadyInit') || `${pt('quotasInitialized')} 0 - ${pt('quotasAllExist')}`, 'success');
        }
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
    const [quotasRes, settingsRes] = await Promise.all([
        apiCall(`/api/quotas/all?year=${year}`),
        apiCall('/api/quotas/settings')
    ]);

    const quotas = (await quotasRes.json()).data || [];
    const settings = (await settingsRes.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('adminQuotasTitle')}</h1><p>${pt('adminQuotasDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-header">
                    <h2>${pt('quotaSettings')}</h2>
                    <button class="btn btn-sm btn-secondary" onclick="openQuotaSettingsModal()">${pt('edit')}</button>
                </div>
                <div class="card-body">
                    <table class="data-table">
                        <thead><tr><th>${pt('quotaSettingsYear')}</th><th>${pt('quotaSettingsDefaultVacation')}</th><th>${pt('quotaSettingsDefaultParagraph')}</th><th>${pt('quotaSettingsDefaultOcr')}</th><th>${pt('quotaSettingsCarryOver')}</th></tr></thead>
                        <tbody>
                            ${settings.map(s => `
                                <tr>
                                    <td><strong>${s.year}</strong></td>
                                    <td>${s.default_vacation_days} ${pt('days')}</td>
                                    <td>${s.default_paragraph_days || 7} ${pt('days')}</td>
                                    <td>${s.default_ocr_days || 7} ${pt('days')}</td>
                                    <td>${s.carry_over_enabled ? `${pt('yes')} (${pt('quotaSettingsCarryOverMax')} ${s.max_carry_over_days} ${pt('days')})` : pt('no')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="portal-card">
                <div class="card-header">
                    <h2>${pt('employeeQuotasYear')} ${year}</h2>
                </div>
                <div class="card-body" style="overflow-x:auto;">
                    <table class="data-table">
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
                                    <td>${q.paragraph_days_used || 0}</td>
                                    <td><strong style="color:${q.paragraph_days_remaining <= 1 ? 'var(--red-500)' : 'var(--green-600)'}">${q.paragraph_days_remaining}</strong></td>
                                    <td>${q.ocr_days_total || 7}</td>
                                    <td>${q.ocr_days_used || 0}</td>
                                    <td><strong style="color:${q.ocr_days_remaining <= 1 ? 'var(--red-500)' : 'var(--green-600)'}">${q.ocr_days_remaining}</strong></td>
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

async function openQuotaSettingsModal() {
    const year = new Date().getFullYear();

    // Load existing settings to pre-fill
    let existingVacation = 20;
    let existingSick = 5;
    let existingParagraph = 7;
    let existingOcr = 7;
    try {
        const res = await apiCall('/api/quotas/settings');
        const allSettings = (await res.json()).data || [];
        const current = allSettings.find(s => s.year === year);
        if (current) {
            existingVacation = current.default_vacation_days;
            existingSick = current.default_sick_days;
            existingParagraph = current.default_paragraph_days || 7;
            existingOcr = current.default_ocr_days || 7;
        }
    } catch (e) { /* use defaults */ }

    document.getElementById('modalTitle').textContent = pt('quotaSettings');
    document.getElementById('modalBody').innerHTML = `
        <form id="quotaSettingsForm" data-default-sick="${existingSick}">
            <div class="form-group">
                <label class="form-label">${pt('quotaSettingsYear')}</label>
                <input type="number" class="form-input" name="year" value="${year}" min="2024" max="2030">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('quotaSettingsDefaultVacation')}</label>
                    <input type="number" class="form-input" name="default_vacation_days" value="${existingVacation}" min="0" max="50">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('quotaSettingsDefaultParagraph')}</label>
                    <input type="number" class="form-input" name="default_paragraph_days" value="${existingParagraph}" min="0" max="30">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('quotaSettingsDefaultOcr')}</label>
                    <input type="number" class="form-input" name="default_ocr_days" value="${existingOcr}" min="0" max="30">
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="saveQuotaSettings()">${pt('save')}</button>
    `;
    openModal();
}

async function saveQuotaSettings() {
    const form = document.getElementById('quotaSettingsForm');
    const data = {
        year: parseInt(form.year.value),
        default_vacation_days: parseInt(form.default_vacation_days.value),
        default_sick_days: parseInt(form.dataset.defaultSick),
        default_paragraph_days: parseInt(form.default_paragraph_days.value),
        default_ocr_days: parseInt(form.default_ocr_days.value)
    };

    try {
        const response = await apiCall('/api/quotas/settings', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(pt('saveFailed'));
        showToast(pt('quotaSettingsSaved'), 'success');
        closeModal();
        navigateToPage('admin-quotas');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Edit individual user quotas
async function editUserQuotas(userId, userName, vacTotal, vacRemaining, paragraphTotal, paragraphRemaining, ocrTotal, ocrRemaining) {
    const year = new Date().getFullYear();
    document.getElementById('modalTitle').textContent = `${pt('editQuota')} - ${userName}`;
    document.getElementById('modalBody').innerHTML = `
        <form id="userQuotaForm">
            <div class="form-group">
                <label class="form-label" style="font-weight:600;margin-bottom:8px;">${pt('quotaFieldVacation')}</label>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">${pt('quotaNarok')}</label>
                        <input type="number" class="form-input" name="vacation_days_total" value="${vacTotal}" min="0" max="50" step="0.5">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${pt('quotaZostatok')}</label>
                        <input type="number" class="form-input" name="vacation_days_remaining" value="${vacRemaining}" min="0" max="50" step="0.5">
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-weight:600;margin-bottom:8px;">${pt('quotaFieldParagraph')}</label>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">${pt('quotaNarok')}</label>
                        <input type="number" class="form-input" name="paragraph_days_total" value="${paragraphTotal}" min="0" max="30" step="0.5">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${pt('quotaZostatok')}</label>
                        <input type="number" class="form-input" name="paragraph_days_remaining" value="${paragraphRemaining}" min="0" max="30" step="0.5">
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-weight:600;margin-bottom:8px;">${pt('quotaFieldOcr')}</label>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">${pt('quotaNarok')}</label>
                        <input type="number" class="form-input" name="ocr_days_total" value="${ocrTotal}" min="0" max="30" step="0.5">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${pt('quotaZostatok')}</label>
                        <input type="number" class="form-input" name="ocr_days_remaining" value="${ocrRemaining}" min="0" max="30" step="0.5">
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

    const vacTotal = parseFloat(form.vacation_days_total.value);
    const vacRemaining = parseFloat(form.vacation_days_remaining.value);
    const paragraphTotal = parseFloat(form.paragraph_days_total.value);
    const paragraphRemaining = parseFloat(form.paragraph_days_remaining.value);
    const ocrTotal = parseFloat(form.ocr_days_total.value);
    const ocrRemaining = parseFloat(form.ocr_days_remaining.value);

    // Calculate used values: used = total - remaining
    const data = {
        year,
        vacation_days_total: vacTotal,
        vacation_days_used: vacTotal - vacRemaining,
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
            <div class="portal-card">
                <div class="card-header">
                    <h3>${pt('documentsSection')}</h3>
                </div>
                <div class="card-body" style="overflow-x:auto;">
                    ${notes.length > 0 ? `
                        <table class="data-table">
                            <thead>
                                <tr><th>${pt('colEmployeeName')}</th><th>${pt('colDocType')}</th><th>${pt('colName')}</th><th>${pt('colDate')}</th><th>${pt('sickNoteColDoctor')}</th><th>${pt('colDocument')}</th></tr>
                            </thead>
                            <tbody>
                                ${notes.map(n => {
                                    const docLabel = n.document_type === 'ocr' ? (pt('sickNoteDocTypeOcr') || 'OČR') : (pt('sickNoteDocTypeParagraph') || 'Paragraf');
                                    const docBadge = n.document_type === 'ocr' ? 'badge-sick' : 'badge-paragraph';
                                    return `
                                    <tr>
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
                    ` : `<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">${pt('noSickNotes')}</div></div>`}
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
            <div><h1>${pt('allTicketsTitle')}</h1><p>${pt('allTicketsDesc')} (${year})</p></div>
        </div>
        <div class="page-body">
            <div class="filters-bar">
                <select class="form-select" id="adminTicketStatus" onchange="filterAdminTickets()">
                    <option value="">${pt('filterAllStatuses')}</option>
                    <option value="Pending">${pt('filterPending')}</option>
                    <option value="Approved">${pt('filterApproved')}</option>
                    <option value="Rejected">${pt('filterRejected')}</option>
                </select>
                <select class="form-select" id="adminTicketType" onchange="filterAdminTickets()">
                    <option value="">${pt('filterAllTypes')}</option>
                    <option value="vacation">${pt('filterVacation')}</option>
                    <option value="sick-leave">${pt('filterSickLeave')}</option>
                    <option value="purchase">${pt('filterPurchase')}</option>
                    <option value="expense">${pt('filterExpense')}</option>
                    <option value="hr">${pt('filterHr')}</option>
                    <option value="other">${pt('filterOther')}</option>
                </select>
            </div>
            <div id="adminTicketsList" class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    ${renderAdminTicketsTable(tickets)}
                </div>
            </div>
        </div>
    `;

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
    if (!tickets.length) return `<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">${pt('noTickets')}</div></div>`;
    return `
        <table class="data-table">
            <thead>
                <tr><th>${pt('colTicketId')}</th><th>${pt('colName')}</th><th>${pt('colType')}</th><th>${pt('colCreatedBy')}</th><th>${pt('colApprover')}</th><th>${pt('colStatus')}</th><th>${pt('colDate')}</th></tr>
            </thead>
            <tbody>
                ${tickets.map(t => `
                    <tr>
                        <td><code>${t.ticket_id}</code></td>
                        <td>${escapeHtml(t.title)}</td>
                        <td><span class="badge badge-${{'vacation':'vacation','sick-leave':'sick','paragraph':'paragraph','ocr':'ocr'}[t.ticket_type] || 'user'}">${translateType(t.ticket_type)}</span></td>
                        <td>${escapeHtml(t.created_by_name)}</td>
                        <td>${t.assigned_approver_name ? escapeHtml(t.assigned_approver_name) : '-'}</td>
                        <td><span class="badge badge-${t.status.toLowerCase()}">${translateStatus(t.status)}</span></td>
                        <td>${formatDate(t.created_at)}${t.start_date ? `<br><small>${formatDate(t.start_date)} - ${formatDate(t.end_date)}</small>` : ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
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
