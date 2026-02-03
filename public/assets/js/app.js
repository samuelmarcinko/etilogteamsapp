// Initialize Microsoft Teams SDK
let teamsContext = null;
let currentUser = null;
let ticketTypesData = []; // Loaded from API
let userQuotaData = null; // Cached quota data

// Toggle date fields visibility based on ticket type
function toggleDateFields() {
    const ticketType = document.getElementById('ticketType').value;
    const dateRangeContainer = document.getElementById('dateRangeContainer');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');

    // Check if selected type requires dates (from API data)
    const typeInfo = ticketTypesData.find(t => t.key === ticketType);
    const needsDates = typeInfo ? typeInfo.requires_dates : false;

    if (needsDates) {
        dateRangeContainer.style.display = 'flex';
        startDateInput.required = true;
        endDateInput.required = true;
    } else {
        dateRangeContainer.style.display = 'none';
        startDateInput.required = false;
        endDateInput.required = false;
        startDateInput.value = '';
        endDateInput.value = '';
    }

    // Show quota info for vacation / sick-leave
    updateQuotaInfoBanner(ticketType);
}

// Load and display quota info banner
async function updateQuotaInfoBanner(ticketType) {
    const banner = document.getElementById('quotaInfoBanner');
    if (!banner) return;

    const quotaMap = {
        'vacation':   { totalKey: 'vacation_days_total',   usedKey: 'vacation_days_used',   remainKey: 'vacation_days_remaining',   labelKey: 'quotaInfoVacation', warnAt: 5 },
        'sick-leave': { totalKey: 'sick_days_total',       usedKey: 'sick_days_used',       remainKey: 'sick_days_remaining',       labelKey: 'quotaInfoSick',     warnAt: 2 },
        'paragraph':  { totalKey: 'paragraph_days_total',  usedKey: 'paragraph_days_used',  remainKey: 'paragraph_days_remaining',  labelKey: 'quotaInfoParagraph', warnAt: 2 },
        'ocr':        { totalKey: 'ocr_days_total',        usedKey: 'ocr_days_used',        remainKey: 'ocr_days_remaining',        labelKey: 'quotaInfoOcr',      warnAt: 2 }
    };

    const config = quotaMap[ticketType];
    if (!config) {
        banner.style.display = 'none';
        return;
    }

    // Fetch quota if not cached
    if (!userQuotaData && currentUser?.id) {
        try {
            const year = new Date().getFullYear();
            const res = await fetch(`/api/teams/dashboard?userId=${currentUser.id}&year=${year}`);
            if (res.ok) {
                const result = await res.json();
                userQuotaData = result.data?.quota || null;
            }
        } catch (e) {
            console.warn('Could not load quota:', e);
        }
    }

    if (!userQuotaData) {
        banner.style.display = 'block';
        banner.className = 'quota-info-banner quota-info-neutral';
        banner.innerHTML = `<span class="quota-info-icon">&#9432;</span> <span>${t('quotaInfoNotSet')}</span>`;
        return;
    }

    const total = userQuotaData[config.totalKey];
    const used = userQuotaData[config.usedKey];
    const remaining = userQuotaData[config.remainKey];
    const label = t(config.labelKey);
    const colorClass = remaining > config.warnAt ? 'quota-info-good' : remaining > 0 ? 'quota-info-warn' : 'quota-info-danger';

    banner.style.display = 'block';
    banner.className = `quota-info-banner ${colorClass}`;
    banner.innerHTML = `
        <div class="quota-info-main">
            <span class="quota-info-label">${label}</span>
            <span class="quota-info-value">${remaining} ${t('quotaInfoDays')} ${t('quotaInfoRemaining')}</span>
        </div>
        <div class="quota-info-bar-track">
            <div class="quota-info-bar-fill" style="width:${total > 0 ? ((total - remaining) / total * 100) : 0}%"></div>
        </div>
        <span class="quota-info-detail">${used} ${t('quotaInfoOf')} ${total} ${t('quotaInfoDays')}</span>
    `;
}

// Load ticket types from API
async function loadTicketTypes() {
    const typeSelect = document.getElementById('ticketType');
    try {
        const response = await fetch('/api/ticket-types/active');
        if (!response.ok) throw new Error('Failed to load ticket types');

        const result = await response.json();
        ticketTypesData = result.data || [];

        // Get current language
        const lang = localStorage.getItem('appLanguage') || 'en';

        // Keep placeholder
        typeSelect.innerHTML = `<option value="">${t('placeholderType')}</option>`;

        ticketTypesData.forEach(tt => {
            const option = document.createElement('option');
            option.value = tt.key;
            option.textContent = lang === 'sk' ? tt.label_sk : tt.label_en;
            option.dataset.labelSk = tt.label_sk;
            option.dataset.labelEn = tt.label_en;
            typeSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading ticket types:', error);
    }
}

// Update ticket type labels when language changes
function updateTicketTypeLabels() {
    const lang = localStorage.getItem('appLanguage') || 'en';
    const typeSelect = document.getElementById('ticketType');
    if (!typeSelect) return;

    typeSelect.querySelectorAll('option[data-label-sk]').forEach(opt => {
        opt.textContent = lang === 'sk' ? opt.dataset.labelSk : opt.dataset.labelEn;
    });
}

// Override the original switchLanguage to also update ticket type labels + quota
const _originalSwitchLanguage = typeof switchLanguage === 'function' ? switchLanguage : null;
if (_originalSwitchLanguage) {
    window.switchLanguage = function(lang) {
        _originalSwitchLanguage(lang);
        updateTicketTypeLabels();
        // Refresh quota banner with new language
        const ticketType = document.getElementById('ticketType')?.value;
        if (ticketType) updateQuotaInfoBanner(ticketType);
    };
}

// Initialize app
(async function init() {
    try {
        await microsoftTeams.app.initialize();
        teamsContext = await microsoftTeams.app.getContext();
        currentUser = teamsContext.user;

        // Fetch current user info from Graph API to get displayName
        try {
            const userResponse = await fetch(`/api/users/${currentUser.id}`);
            if (userResponse.ok) {
                const userResult = await userResponse.json();
                currentUser = {
                    ...currentUser,
                    displayName: userResult.data.name,
                    graphEmail: userResult.data.email
                };
            }
        } catch (error) {
            console.warn('Could not fetch user from Graph API, using Teams context only:', error);
        }

        // Load ticket types and approvers in parallel
        await Promise.all([
            loadTicketTypes(),
            loadApprovers()
        ]);

        // Pre-fetch quota data
        if (currentUser?.id) {
            try {
                const year = new Date().getFullYear();
                const res = await fetch(`/api/teams/dashboard?userId=${currentUser.id}&year=${year}`);
                if (res.ok) {
                    const result = await res.json();
                    userQuotaData = result.data?.quota || null;
                }
            } catch (e) { /* ignore */ }
        }

    } catch (error) {
        console.error('Error initializing Teams:', error);
        showToast(t('alertErrorInit'), 'error');
    }
})();

// Load list of approvers (managers)
async function loadApprovers() {
    const approverSelect = document.getElementById('approver');

    try {
        const response = await fetch('/api/users');

        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const result = await response.json();
        const approvers = result.data || [];

        approverSelect.innerHTML = `<option value="">${t('placeholderApprover')}</option>`;

        approvers.forEach(approver => {
            const option = document.createElement('option');
            option.value = JSON.stringify({
                id: approver.id,
                name: approver.name,
                email: approver.email
            });
            option.textContent = `${approver.name} (${approver.email})`;
            approverSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading approvers:', error);
        showToast(t('alertErrorLoading'), 'error');
    }
}

// Handle form submission
document.getElementById('approvalForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');

    submitBtn.disabled = true;
    btnText.textContent = t('btnSubmitting');
    btnLoader.style.display = 'inline-block';

    try {
        const formData = new FormData(e.target);
        const approverData = JSON.parse(formData.get('approver'));

        const ticketData = {
            title: formData.get('title'),
            description: formData.get('description'),
            ticket_type: formData.get('ticketType'),
            priority: formData.get('priority'),
            created_by_id: currentUser?.id || 'unknown',
            created_by_name: currentUser?.displayName || currentUser?.userPrincipalName || 'Unknown User',
            created_by_email: currentUser?.userPrincipalName || 'unknown@etilog.com',
            assigned_approver_id: approverData.id,
            assigned_approver_name: approverData.name,
            assigned_approver_email: approverData.email,
            start_date: formData.get('startDate') || null,
            end_date: formData.get('endDate') || null
        };

        const response = await fetch('/api/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ticketData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || t('alertErrorSubmit'));
        }

        const result = await response.json();

        showToast(t('alertSuccess'), 'success');

        if (window.refreshApprovalsBadge) {
            window.refreshApprovalsBadge();
        }

        e.target.reset();
        // Hide quota banner after reset
        const banner = document.getElementById('quotaInfoBanner');
        if (banner) banner.style.display = 'none';

        // Reload ticket types and approvers
        await Promise.all([
            loadTicketTypes(),
            loadApprovers()
        ]);

        // Refresh quota data after submission
        userQuotaData = null;

    } catch (error) {
        console.error('Error submitting ticket:', error);
        showToast(t('alertError') + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        btnText.textContent = t('btnSubmit');
        btnLoader.style.display = 'none';
    }
});

// Show toast notification (fixed position, styled)
function showToast(message, type = 'success') {
    // Remove existing toasts
    document.querySelectorAll('.app-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.innerHTML = `
        <span class="app-toast-icon">${type === 'success' ? '&#10004;' : '&#10006;'}</span>
        <span class="app-toast-msg">${message}</span>
        <button class="app-toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    document.body.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('app-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

// Keep old showAlert as alias for backward compat
function showAlert(message, type) {
    showToast(message, type);
}
