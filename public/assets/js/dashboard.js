// Dashboard logic
let teamsContext = null;
let currentUser = null;
let allTickets = [];
let dashboardData = null;
let ticketTypeMap = new Map();

async function loadTicketTypes() {
    try {
        const response = await fetch('/api/ticket-types/active');
        if (!response.ok) throw new Error('Failed to load ticket types');
        const result = await response.json();
        const types = result.data || [];
        ticketTypeMap = new Map(types.map(type => [type.key.toLowerCase(), type]));
    } catch (error) {
        console.warn('Failed to load ticket types:', error);
        ticketTypeMap = new Map();
    }
}

// Initialize
(async function init() {
    try {
        await microsoftTeams.app.initialize();
        teamsContext = await microsoftTeams.app.getContext();
        currentUser = teamsContext.user;

        await loadTicketTypes();
        await loadDashboardData();
    } catch (error) {
        console.error('Error initializing:', error);
    }
})();

// Load all dashboard data
async function loadDashboardData() {
    // Load overview (quotas + holidays) and tickets separately
    // so one failure doesn't block the other
    await Promise.all([
        loadOverviewData(),
        loadTicketsData()
    ]);
}

// Load quota + holiday overview
async function loadOverviewData() {
    try {
        const year = new Date().getFullYear();
        const response = await fetch(`/api/teams/dashboard?userId=${currentUser.id}&year=${year}`);

        if (!response.ok) {
            console.error('Dashboard API error:', response.status);
            throw new Error('API error ' + response.status);
        }

        const result = await response.json();
        dashboardData = result.data;
        renderOverviewCards(dashboardData);

        // Update ticket stats
        const stats = dashboardData.ticketStats;
        document.getElementById('pendingCount').textContent = stats.pending;
        document.getElementById('approvedCount').textContent = stats.approved;
        document.getElementById('rejectedCount').textContent = stats.rejected;
    } catch (error) {
        console.error('Error loading overview:', error);
        // Remove loading animation even on error
        document.querySelectorAll('.overview-card.loading').forEach(c => c.classList.remove('loading'));
        document.getElementById('vacationRemaining').textContent = '-';
        document.getElementById('paragraphRemaining').textContent = '-';
        document.getElementById('ocrRemaining').textContent = '-';
        document.getElementById('nextHolidayName').textContent = '-';
    }
}

// Load tickets separately
async function loadTicketsData() {
    try {
        const [myTicketsRes, myApprovalsRes] = await Promise.all([
            fetch(`/api/tickets?createdById=${currentUser.id}`),
            fetch(`/api/tickets?assignedApproverId=${currentUser.id}`)
        ]);

        if (!myTicketsRes.ok || !myApprovalsRes.ok) {
            throw new Error('Failed to load tickets');
        }

        const myTickets = (await myTicketsRes.json()).data || [];
        const myApprovals = (await myApprovalsRes.json()).data || [];

        allTickets = [...myTickets, ...myApprovals.filter(
            a => !myTickets.find(t => t.id === a.id)
        )];

        // Update stats from tickets if overview didn't load
        if (!dashboardData) {
            const pending = allTickets.filter(t => t.status === 'Pending').length;
            const approved = allTickets.filter(t => t.status === 'Approved').length;
            const rejected = allTickets.filter(t => t.status === 'Rejected').length;
            document.getElementById('pendingCount').textContent = pending;
            document.getElementById('approvedCount').textContent = approved;
            document.getElementById('rejectedCount').textContent = rejected;
        }

        renderRequests(allTickets.slice(0, 10));
    } catch (error) {
        console.error('Error loading tickets:', error);
        document.getElementById('requestsList').innerHTML = `
            <div class="error-message">
                <p>${t('errorLoadingDashboard')}: ${error.message}</p>
            </div>
        `;
    }
}

// Render the quota + holiday overview cards
function renderOverviewCards(data) {
    const lang = getCurrentLang();
    const quota = data.quota;
    const holidays = data.nextHolidays || [];

    // Vacation card
    const vacCard = document.getElementById('vacationCard');
    vacCard.classList.remove('loading');
    if (quota) {
        const vacRemaining = quota.vacation_days_remaining;
        const vacTotal = quota.vacation_days_total;
        const vacUsedPct = Math.round((quota.vacation_days_used / vacTotal) * 100);
        const barClass = vacUsedPct > 90 ? 'bar-red' : vacUsedPct > 70 ? 'bar-amber' : 'bar-green';

        document.getElementById('vacationRemaining').textContent = `${vacRemaining} ${t('dashDays')}`;
        document.getElementById('vacationDetail').textContent = `${quota.vacation_days_used} / ${vacTotal} ${t('dashUsed')}`;
        const vacBar = document.getElementById('vacationBar');
        vacBar.className = `overview-bar-fill ${barClass}`;
        vacBar.style.width = `${Math.min(vacUsedPct, 100)}%`;
    } else {
        document.getElementById('vacationRemaining').textContent = '-';
        document.getElementById('vacationDetail').textContent = t('dashNoQuota');
    }

    // Paragraph card
    const paragraphCard = document.getElementById('paragraphCard');
    paragraphCard.classList.remove('loading');
    if (quota) {
        const parRemaining = quota.paragraph_days_remaining;
        const parTotal = quota.paragraph_days_total;
        const parUsedPct = parTotal > 0 ? Math.round((quota.paragraph_days_used / parTotal) * 100) : 0;
        const parBarClass = parUsedPct > 90 ? 'bar-red' : parUsedPct > 70 ? 'bar-amber' : 'bar-green';

        document.getElementById('paragraphRemaining').textContent = `${parRemaining} ${t('dashDays')}`;
        document.getElementById('paragraphDetail').textContent = `${quota.paragraph_days_used} / ${parTotal} ${t('dashUsed')}`;
        const parBar = document.getElementById('paragraphBar');
        parBar.className = `overview-bar-fill ${parBarClass}`;
        parBar.style.width = `${Math.min(parUsedPct, 100)}%`;
    } else {
        document.getElementById('paragraphRemaining').textContent = '-';
        document.getElementById('paragraphDetail').textContent = t('dashNoQuota');
    }

    // OCR card
    const ocrCard = document.getElementById('ocrCard');
    ocrCard.classList.remove('loading');
    if (quota) {
        const ocrRemaining = quota.ocr_days_remaining;
        const ocrTotal = quota.ocr_days_total;
        const ocrUsedPct = ocrTotal > 0 ? Math.round((quota.ocr_days_used / ocrTotal) * 100) : 0;
        const ocrBarClass = ocrUsedPct > 90 ? 'bar-red' : ocrUsedPct > 70 ? 'bar-amber' : 'bar-green';

        document.getElementById('ocrRemaining').textContent = `${ocrRemaining} ${t('dashDays')}`;
        document.getElementById('ocrDetail').textContent = `${quota.ocr_days_used} / ${ocrTotal} ${t('dashUsed')}`;
        const ocrBar = document.getElementById('ocrBar');
        ocrBar.className = `overview-bar-fill ${ocrBarClass}`;
        ocrBar.style.width = `${Math.min(ocrUsedPct, 100)}%`;
    } else {
        document.getElementById('ocrRemaining').textContent = '-';
        document.getElementById('ocrDetail').textContent = t('dashNoQuota');
    }

    // Next holiday card
    const holCard = document.getElementById('holidayCard');
    holCard.classList.remove('loading');
    if (holidays.length > 0) {
        const next = holidays[0];
        document.getElementById('nextHolidayName').textContent = next.name;
        document.getElementById('nextHolidayDate').textContent = formatHolidayDate(next.date);

        // If there are more holidays, show count
        if (holidays.length > 1) {
            document.getElementById('nextHolidayDate').textContent +=
                ` (+${holidays.length - 1} ${t('dashMoreHolidays')})`;
        }
    } else {
        document.getElementById('nextHolidayName').textContent = t('dashNoUpcomingHoliday');
        document.getElementById('nextHolidayDate').textContent = '';
    }
}

// Format holiday date nicely
function formatHolidayDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const lang = getCurrentLang();
    const now = new Date();
    const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));

    const formatted = date.toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'long'
    });

    if (diffDays === 0) return `${formatted} (${t('dashToday')})`;
    if (diffDays === 1) return `${formatted} (${t('dashTomorrow')})`;
    return `${formatted} (${t('dashInDays').replace('{n}', diffDays)})`;
}

// Render requests list
function renderRequests(tickets) {
    const container = document.getElementById('requestsList');

    if (tickets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>${t('noRequests')}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = tickets.map(ticket => `
        <div class="request-item">
            <div class="request-header">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <h3 class="request-title">${ticket.title}</h3>
                    <span style="font-size: 0.7rem; color: #9ca3af; font-weight: 400; white-space: nowrap; margin-left: 0.5rem; flex-shrink: 0;">${ticket.ticket_id}</span>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <span class="type-badge ${getTypeBadgeClass(ticket.ticket_type)}">${translateTicketType(ticket.ticket_type)}</span>
                    <span class="status-badge status-${ticket.status.toLowerCase()}">${t('status' + ticket.status)}</span>
                </div>
            </div>
            <div class="request-meta">
                <span class="priority-badge priority-${ticket.priority.toLowerCase()}">
                    ${ticket.priority === 'Urgent' ? '&#128293;' : ticket.priority === 'High' ? '&#9888;' : ticket.priority === 'Low' ? '&#128204;' : '&#128203;'} ${t('labelPriorityLabel')}: ${translatePriority(ticket.priority)}
                </span>
                <span class="meta-item">
                    <strong>&#128100; ${t('labelCreatedBy')}:</strong> ${ticket.created_by_name}
                </span>
                ${ticket.start_date && ticket.end_date ? `
                    <span class="meta-item">
                        <strong>&#128197;</strong> ${formatDate(ticket.start_date)} → ${formatDate(ticket.end_date)}
                    </span>
                ` : ''}
            </div>
            <div class="description-box">
                <div class="description-header">${t('labelDescription')}</div>
                <p class="request-description">${ticket.description}</p>
            </div>
        </div>
    `).join('');
}

// Helper functions
function getTypeBadgeClass(type) {
    const classMap = {
        'vacation': 'type-vacation',
        'sick-leave': 'type-sick-leave',
        'paragraph': 'type-paragraph',
        'ocr': 'type-ocr',
        'purchase': 'type-purchase',
        'expense': 'type-expense',
        'hr': 'type-hr',
        'other': 'type-other'
    };
    return classMap[type?.toLowerCase()] || 'type-other';
}

function translateTicketType(type) {
    const key = type?.toLowerCase();
    const fromApi = ticketTypeMap.get(key);
    if (fromApi) {
        const lang = getCurrentLang();
        return lang === 'sk' ? (fromApi.label_sk || fromApi.key) : (fromApi.label_en || fromApi.key);
    }
    const typeMap = {
        'vacation': 'typeVacation',
        'sick-leave': 'typeSickLeave',
        'paragraph': 'typeParagraph',
        'ocr': 'typeOcr',
        'purchase': 'typePurchase',
        'expense': 'typeExpense',
        'hr': 'typeHr',
        'other': 'typeOther'
    };
    return t(typeMap[key] || 'typeOther');
}

function translatePriority(priority) {
    const priorityMap = {
        'low': 'priorityLow',
        'medium': 'priorityMedium',
        'high': 'priorityHigh',
        'urgent': 'priorityUrgent'
    };
    return t(priorityMap[priority?.toLowerCase()] || 'priorityMedium');
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const lang = getCurrentLang();
    return date.toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Override switchLanguage to re-render with new translations
const originalSwitchLanguage = window.switchLanguage;
window.switchLanguage = function(lang) {
    originalSwitchLanguage(lang);
    if (dashboardData) {
        renderOverviewCards(dashboardData);
    }
    renderRequests(allTickets.slice(0, 10));
};
