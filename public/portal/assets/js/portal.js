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
            case 'admin-dashboard': await renderAdminDashboard(content); break;
            case 'admin-employees': await renderAdminEmployees(content); break;
            case 'admin-quotas': await renderAdminQuotas(content); break;
            case 'admin-sick-notes': await renderAdminSickNotes(content); break;
            case 'admin-tickets': await renderAdminTickets(content); break;
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
    const sickUsedPct = quota ? Math.round((parseFloat(quota.sick_days_used) / quota.sick_days_total) * 100) : 0;

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
                    <div class="stat-icon amber">&#129298;</div>
                    <div><div class="stat-value">${quota ? quota.sick_days_remaining : '-'}</div><div class="stat-label">${pt('sickDaysRemaining')}</div></div>
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
                            <span>${pt('sickLeave')}</span>
                            <span>${quota ? parseFloat(quota.sick_days_used) : 0} / ${quota ? quota.sick_days_total : 5} ${pt('days')}</span>
                        </div>
                        <div class="quota-bar">
                            <div class="quota-bar-fill ${sickUsedPct > 90 ? 'red' : sickUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(sickUsedPct, 100)}%"></div>
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
                                        <td>${escapeHtml(t.title)}</td>
                                        <td><span class="badge badge-${t.ticket_type === 'vacation' ? 'vacation' : t.ticket_type === 'sick-leave' ? 'sick' : 'user'}">${translateType(t.ticket_type)}</span></td>
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
    const sickUsedPct = quota ? Math.round((parseFloat(quota.sick_days_used) / quota.sick_days_total) * 100) : 0;

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
                <div class="quota-icon">&#129298;</div>
                <div class="quota-details">
                    <div class="quota-type">${pt('sickLeave')}</div>
                    <div class="quota-numbers">
                        <span>${pt('quotaTotal')}: <strong>${quota ? quota.sick_days_total : '-'} ${pt('days')}</strong></span>
                        <span>${pt('quotaUsed')}: <strong>${quota ? parseFloat(quota.sick_days_used) : 0} ${pt('days')}</strong></span>
                        <span>${pt('quotaRemaining')}: <strong>${quota ? quota.sick_days_remaining : '-'} ${pt('days')}</strong></span>
                    </div>
                    <div class="quota-bar" style="margin-top: 0.75rem;">
                        <div class="quota-bar-fill ${sickUsedPct > 90 ? 'red' : sickUsedPct > 70 ? 'amber' : 'green'}" style="width: ${Math.min(sickUsedPct, 100)}%"></div>
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
                <table class="data-table">
                    <thead>
                        <tr><th>${pt('sickNoteColName')}</th><th>${pt('sickNoteColFrom')}</th><th>${pt('sickNoteColTo')}</th><th>${pt('sickNoteColDoctor')}</th><th>${pt('sickNoteColFile')}</th><th></th></tr>
                    </thead>
                    <tbody>
                        ${notes.map(n => `
                            <tr>
                                <td><strong>${escapeHtml(n.title)}</strong>${n.diagnosis ? `<br><small style="color:var(--gray-500)">${escapeHtml(n.diagnosis)}</small>` : ''}</td>
                                <td>${formatDate(n.start_date)}</td>
                                <td>${formatDate(n.end_date)}</td>
                                <td>${n.doctor_name ? escapeHtml(n.doctor_name) : '-'}</td>
                                <td>${n.file_name ? `<a href="#" onclick="previewSickNoteFile(${n.id}, '${escapeHtml(n.file_name)}')" style="color:var(--blue-600)">&#128065; ${escapeHtml(n.file_name)}</a>` : `<span style="color:var(--gray-400)">${pt('noFile')}</span>`}</td>
                                <td>
                                    <button class="btn btn-ghost btn-sm" onclick="openUploadSickNoteModal(${n.id})">&#128206;</button>
                                    <button class="btn btn-ghost btn-sm" onclick="deleteSickNote(${n.id})" style="color:var(--red-500)">&#128465;</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : `<div class="empty-state"><div class="empty-icon">&#128203;</div><div class="empty-text">${pt('noSickNotes')}</div></div>`}
        </div>
    `;
}

async function openNewSickNoteModal() {
    document.getElementById('modalTitle').textContent = pt('newSickNoteTitle');
    document.getElementById('modalBody').innerHTML = `
        <form id="sickNoteForm">
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

async function previewSickNoteFile(id, fileName) {
    try {
        const response = await apiCall(`/api/sick-notes/${id}/file`);
        if (!response.ok) throw new Error(pt('fileNotFound'));

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const ext = fileName.toLowerCase().split('.').pop();
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif'].includes(ext);
        const isPdf = ext === 'pdf';

        const overlay = document.createElement('div');
        overlay.id = 'fileLightbox';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); window.URL.revokeObjectURL(url); } };

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;max-width:90vw;max-height:90vh;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.3);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--gray-50,#f9fafb);border-bottom:1px solid var(--gray-200,#e5e7eb);';
        header.innerHTML = `
            <span style="font-weight:600;font-size:14px;color:#374151;">${escapeHtml(fileName)}</span>
            <div style="display:flex;gap:8px;">
                <button onclick="event.stopPropagation();const a=document.createElement('a');a.href='${url}';a.download='${escapeHtml(fileName)}';a.click();" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;" title="${pt('download')}">&#11015; ${pt('download')}</button>
                <button onclick="event.stopPropagation();document.getElementById('fileLightbox').remove();" style="padding:6px 10px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;font-size:16px;line-height:1;" title="${pt('close')}">&#10005;</button>
            </div>
        `;
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

        const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); window.URL.revokeObjectURL(url); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);

    } catch (error) {
        showToast(pt('fileLoadError') + ': ' + error.message, 'error');
    }
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

async function renderMyRequests(container) {
    const response = await apiCall(`/api/tickets?createdById=${portalUser.id}`);
    const tickets = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('myRequestsTitle')}</h1><p>${pt('myRequestsDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="filters-bar">
                <select class="form-select" onchange="filterMyRequests(this.value)" id="myReqFilter">
                    <option value="">${pt('filterAllStatuses')}</option>
                    <option value="Pending">${pt('filterPending')}</option>
                    <option value="Approved">${pt('filterApproved')}</option>
                    <option value="Rejected">${pt('filterRejected')}</option>
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
                            <tr><th>${pt('colName')}</th><th>${pt('colEmail')}</th><th>${pt('colRole')}</th><th>${pt('colVacation')}</th><th>${pt('colSickDays')}</th><th>${pt('colActions')}</th></tr>
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
                                        <button class="btn btn-ghost btn-sm" onclick="toggleEmployeeRole('${e.id}', '${e.role}')" title="${pt('changeRoleTitle')}">${e.role === 'admin' ? '&#128100;' : '&#128081;'}</button>
                                        <button class="btn btn-ghost btn-sm" onclick="editEmployeeQuota('${e.id}', '${escapeHtml(e.name)}', ${e.vacation_days_total || 20}, ${e.sick_days_total || 5})" title="${pt('editQuotaTitle')}">&#9999;</button>
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

async function editEmployeeQuota(userId, name, vacTotal, sickTotal) {
    const year = new Date().getFullYear();
    document.getElementById('modalTitle').textContent = `${pt('quotaModalTitle')} - ${name}`;
    document.getElementById('modalBody').innerHTML = `
        <form id="quotaForm">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('quotaFieldVacation')}</label>
                    <input type="number" class="form-input" name="vacation_days_total" value="${vacTotal}" min="0" max="50">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('quotaFieldSickDays')}</label>
                    <input type="number" class="form-input" name="sick_days_total" value="${sickTotal}" min="0" max="30">
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${pt('cancel')}</button>
        <button class="btn btn-primary" onclick="saveEmployeeQuota('${userId}', ${year})">${pt('save')}</button>
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
        if (!response.ok) throw new Error(pt('saveFailed'));
        showToast(pt('quotaSaved'), 'success');
        closeModal();
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
        showToast(`${pt('quotasInitialized')} ${result.count} ${pt('employees')}`, 'success');
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
                        <thead><tr><th>${pt('quotaSettingsYear')}</th><th>${pt('quotaSettingsDefaultVacation')}</th><th>${pt('quotaSettingsDefaultSick')}</th><th>${pt('quotaSettingsCarryOver')}</th></tr></thead>
                        <tbody>
                            ${settings.map(s => `
                                <tr>
                                    <td><strong>${s.year}</strong></td>
                                    <td>${s.default_vacation_days} ${pt('days')}</td>
                                    <td>${s.default_sick_days} ${pt('days')}</td>
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
                            <tr><th>${pt('colEmployee')}</th><th>${pt('colVacTotal')}</th><th>${pt('colVacUsed')}</th><th>${pt('colBalance')}</th><th>${pt('colSickTotal')}</th><th>${pt('colSickUsed')}</th><th>${pt('colBalance')}</th></tr>
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
    document.getElementById('modalTitle').textContent = pt('quotaSettings');
    document.getElementById('modalBody').innerHTML = `
        <form id="quotaSettingsForm">
            <div class="form-group">
                <label class="form-label">${pt('quotaSettingsYear')}</label>
                <input type="number" class="form-input" name="year" value="${year}" min="2024" max="2030">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${pt('quotaSettingsDefaultVacation')}</label>
                    <input type="number" class="form-input" name="default_vacation_days" value="20" min="0" max="50">
                </div>
                <div class="form-group">
                    <label class="form-label">${pt('quotaSettingsDefaultSick')}</label>
                    <input type="number" class="form-input" name="default_sick_days" value="5" min="0" max="30">
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
        default_sick_days: parseInt(form.default_sick_days.value)
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

// ============================================
// ADMIN SICK NOTES
// ============================================

async function renderAdminSickNotes(container) {
    const year = new Date().getFullYear();
    const response = await apiCall(`/api/sick-notes/all?year=${year}`);
    const notes = (await response.json()).data || [];

    container.innerHTML = `
        <div class="page-header">
            <div><h1>${pt('allSickNotesTitle')}</h1><p>${pt('allSickNotesDesc')}</p></div>
        </div>
        <div class="page-body">
            <div class="portal-card">
                <div class="card-body" style="overflow-x:auto;">
                    ${notes.length > 0 ? `
                        <table class="data-table">
                            <thead>
                                <tr><th>${pt('colEmployeeName')}</th><th>${pt('colName')}</th><th>${pt('sickNoteColFrom')}</th><th>${pt('sickNoteColTo')}</th><th>${pt('sickNoteColDoctor')}</th><th>${pt('colDocument')}</th></tr>
                            </thead>
                            <tbody>
                                ${notes.map(n => `
                                    <tr>
                                        <td><strong>${escapeHtml(n.user_name)}</strong><br><small style="color:var(--gray-500)">${escapeHtml(n.user_email)}</small></td>
                                        <td>${escapeHtml(n.title)}${n.diagnosis ? `<br><small style="color:var(--gray-500)">${escapeHtml(n.diagnosis)}</small>` : ''}</td>
                                        <td>${formatDate(n.start_date)}</td>
                                        <td>${formatDate(n.end_date)}</td>
                                        <td>${n.doctor_name ? escapeHtml(n.doctor_name) : '-'}</td>
                                        <td>${n.file_name ? `<a href="#" onclick="previewSickNoteFile(${n.id}, '${escapeHtml(n.file_name)}')" style="color:var(--blue-600);cursor:pointer;">&#128065; ${escapeHtml(n.file_name)}</a>` : '<span style="color:var(--gray-400)">-</span>'}</td>
                                    </tr>
                                `).join('')}
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
                        <td><span class="badge badge-${t.ticket_type === 'vacation' ? 'vacation' : t.ticket_type === 'sick-leave' ? 'sick' : 'user'}">${translateType(t.ticket_type)}</span></td>
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
// HELPERS
// ============================================

function renderTicketsTable(tickets) {
    if (!tickets.length) return `<div class="empty-state"><div class="empty-icon">&#128196;</div><div class="empty-text">${pt('noTickets')}</div></div>`;
    return `
        <div class="portal-card">
            <div class="card-body" style="overflow-x:auto;">
                <table class="data-table">
                    <thead>
                        <tr><th>${pt('colName')}</th><th>${pt('colType')}</th><th>${pt('colApprover')}</th><th>${pt('colStatus')}</th><th>${pt('colDate')}</th></tr>
                    </thead>
                    <tbody>
                        ${tickets.map(t => `
                            <tr>
                                <td><strong>${escapeHtml(t.title)}</strong>${t.rejection_reason ? `<br><small style="color:var(--red-500)">${pt('reason')}: ${escapeHtml(t.rejection_reason)}</small>` : ''}</td>
                                <td><span class="badge badge-${t.ticket_type === 'vacation' ? 'vacation' : t.ticket_type === 'sick-leave' ? 'sick' : 'user'}">${translateType(t.ticket_type)}</span></td>
                                <td>${t.assigned_approver_name ? escapeHtml(t.assigned_approver_name) : '-'}</td>
                                <td><span class="badge badge-${t.status.toLowerCase()}">${translateStatus(t.status)}</span></td>
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
