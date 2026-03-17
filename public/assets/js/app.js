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
    const halfDayContainer = document.getElementById('halfDayContainer');

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
        // Hide half-day toggle when dates are not needed
        if (halfDayContainer) {
            halfDayContainer.style.display = 'none';
            setHalfDay(false);
        }
    }

    // Show quota info for vacation / sick-leave
    updateQuotaInfoBanner(ticketType);
    // Check half-day toggle visibility
    checkHalfDayToggle();
}

// Track selected working days for validation
let selectedWorkingDays = 0;
let hasEnoughDays = true;

// Check if half-day toggle should be shown (when start date = end date)
function checkHalfDayToggle() {
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    const halfDayContainer = document.getElementById('halfDayContainer');
    const ticketType = document.getElementById('ticketType')?.value;

    if (!halfDayContainer) return;

    // Check if type supports half-day (only vacation)
    const halfDayTypes = ['vacation'];
    const supportsHalfDay = halfDayTypes.includes(ticketType);

    // Show toggle only if both dates are the same and type supports half-day
    if (startDate && endDate && startDate === endDate && supportsHalfDay) {
        halfDayContainer.style.display = 'block';
    } else {
        halfDayContainer.style.display = 'none';
        // Reset to full day when hiding
        setHalfDay(false);
    }

    // Update selected days info
    updateSelectedDaysInfo();
}

// Calculate and display selected working days
async function updateSelectedDaysInfo() {
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    const ticketType = document.getElementById('ticketType')?.value;
    const banner = document.getElementById('quotaInfoBanner');
    const submitBtn = document.getElementById('submitBtn');
    const isHalfDay = document.getElementById('isHalfDay')?.value === 'true';
    const warningContainer = document.getElementById('quotaWarningContainer');
    const selectedDaysInline = document.getElementById('selectedDaysInline');
    const selectedDaysValue = document.getElementById('selectedDaysValue');

    // Only for quota types with dates - case-insensitive check
    const quotaTypes = ['vacation', 'sick-leave', 'paragraph', 'ocr'];
    const ticketTypeLower = (ticketType || '').toLowerCase();
    if (!banner || !quotaTypes.includes(ticketTypeLower) || !startDate || !endDate) {
        selectedWorkingDays = 0;
        hasEnoughDays = true;
        if (selectedDaysInline) selectedDaysInline.style.display = 'none';
        if (warningContainer) warningContainer.innerHTML = '';
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
        if (warningContainer) {
            warningContainer.innerHTML = `
                <div class="quota-warning-bar quota-warning-error">
                    <strong>&#9888;</strong> ${t('dateRangeError')}
                </div>
            `;
        }
        hasEnoughDays = false;
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    // Fetch working days from API
    try {
        const res = await fetch(`/api/teams/dashboard/working-days?startDate=${startDate}&endDate=${endDate}`);
        if (res.ok) {
            const result = await res.json();
            selectedWorkingDays = result.data?.workingDays || 0;

            // If half-day is selected and single day, use 0.5
            if (isHalfDay && startDate === endDate) {
                selectedWorkingDays = 0.5;
            }

            // Get remaining days from cached quota
            let remainingDays = 0;
            if (userQuotaData) {
                const quotaMap = {
                    'vacation': 'vacation_days_remaining',
                    'sick-leave': 'sick_days_remaining',
                    'paragraph': 'paragraph_days_remaining',
                    'ocr': 'ocr_days_remaining'
                };
                remainingDays = userQuotaData[quotaMap[ticketTypeLower]] || 0;
            }

            hasEnoughDays = selectedWorkingDays <= remainingDays;

            // Update inline selected days display
            if (selectedDaysInline && selectedDaysValue) {
                selectedDaysInline.style.display = 'inline-flex';
                selectedDaysValue.textContent = `${selectedWorkingDays} ${t('quotaInfoDays')}`;
                selectedDaysValue.style.color = hasEnoughDays ? '#0d6efd' : '#dc3545';
            }

            // Show/hide warning
            if (warningContainer) {
                if (!hasEnoughDays) {
                    const warningMsg = t('notEnoughDaysWarning')
                        .replace('{selected}', selectedWorkingDays)
                        .replace('{remaining}', remainingDays);
                    warningContainer.innerHTML = `
                        <div class="quota-warning-bar">
                            <strong>&#9888;</strong> ${warningMsg}
                        </div>
                    `;
                } else {
                    warningContainer.innerHTML = '';
                }
            }

            // Enable/disable submit button
            if (submitBtn) submitBtn.disabled = !hasEnoughDays;
        }
    } catch (e) {
        console.warn('Could not calculate working days:', e);
    }
}

// Set half-day value
function setHalfDay(isHalfDay) {
    const halfDayInput = document.getElementById('isHalfDay');
    const fullDayBtn = document.getElementById('fullDayBtn');
    const halfDayBtn = document.getElementById('halfDayBtn');

    if (halfDayInput) {
        halfDayInput.value = isHalfDay ? 'true' : 'false';
    }

    if (fullDayBtn && halfDayBtn) {
        if (isHalfDay) {
            fullDayBtn.classList.remove('active');
            halfDayBtn.classList.add('active');
        } else {
            fullDayBtn.classList.add('active');
            halfDayBtn.classList.remove('active');
        }
    }

    // Recalculate selected days when half-day changes
    updateSelectedDaysInfo();
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

    // Vacation: show remaining balance with placeholder for selected days
    if (ticketType === 'vacation') {
        banner.innerHTML = `
            <div class="quota-info-main">
                <span class="quota-info-inline">
                    <span class="quota-info-label">${label}:</span>
                    <span class="quota-info-value">${remaining} ${t('quotaInfoDays')}</span>
                </span>
                <span class="quota-info-inline quota-info-selected-inline" id="selectedDaysInline" style="display:none;">
                    <span class="quota-info-label">${t('selectedDays')}:</span>
                    <span class="quota-info-value" id="selectedDaysValue">0 ${t('quotaInfoDays')}</span>
                </span>
            </div>
            <div id="quotaWarningContainer"></div>
        `;
        // Update selected days info if dates are already set (delay to ensure DOM is ready)
        setTimeout(() => updateSelectedDaysInfo(), 0);
    } else {
        // Paragraph, OCR: show progress bar and used/total (with 2 decimal places)
        banner.innerHTML = `
            <div class="quota-info-main">
                <span class="quota-info-label">${label}</span>
                <span class="quota-info-value">${Number(remaining).toFixed(2)} ${t('quotaInfoDays')} ${t('quotaInfoRemaining')}</span>
            </div>
            <div class="quota-info-bar-track">
                <div class="quota-info-bar-fill" style="width:${total > 0 ? ((total - remaining) / total * 100) : 0}%"></div>
            </div>
            <span class="quota-info-detail">${Number(used).toFixed(2)} ${t('quotaInfoOf')} ${total} ${t('quotaInfoDays')}</span>
        `;
        // Update selected days info if dates are already set
        updateSelectedDaysInfo();
    }
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

    // Check if user has enough days for quota types
    if (!hasEnoughDays) {
        showToast(t('notEnoughDaysWarning').replace('{selected}', selectedWorkingDays).replace('{remaining}', '0'), 'error');
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');

    submitBtn.disabled = true;
    btnText.textContent = t('btnSubmitting');
    btnLoader.style.display = 'inline-block';

    try {
        const formData = new FormData(e.target);
        const approverData = JSON.parse(formData.get('approver'));

        const ticketData = new FormData();
        ticketData.append('title', formData.get('title'));
        ticketData.append('description', formData.get('description'));
        ticketData.append('ticket_type', formData.get('ticketType'));
        ticketData.append('priority', formData.get('priority'));
        ticketData.append('created_by_id', currentUser?.id || 'unknown');
        ticketData.append('created_by_name', currentUser?.displayName || currentUser?.userPrincipalName || 'Unknown User');
        ticketData.append('created_by_email', currentUser?.userPrincipalName || 'unknown@etilog.com');
        ticketData.append('assigned_approver_id', approverData.id);
        ticketData.append('assigned_approver_name', approverData.name);
        ticketData.append('assigned_approver_email', approverData.email);
        ticketData.append('start_date', formData.get('startDate') || '');
        ticketData.append('end_date', formData.get('endDate') || '');
        ticketData.append('is_half_day', formData.get('isHalfDay') || 'false');

        const attachments = formData.getAll('attachments');
        attachments.forEach(file => {
            if (file && file.size) {
                ticketData.append('attachments', file);
            }
        });

        const response = await fetch('/api/tickets', {
            method: 'POST',
            body: ticketData
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
