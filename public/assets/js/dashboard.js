// Dashboard logic
let teamsContext = null;
let currentUser = null;
let allTickets = [];
let dashboardData = null;

// Initialize
(async function init() {
    try {
        await microsoftTeams.app.initialize();
        teamsContext = await microsoftTeams.app.getContext();
        currentUser = teamsContext.user;

        await loadDashboardData();
    } catch (error) {
        console.error('Error initializing:', error);
    }
})();

// Load all dashboard data
async function loadDashboardData() {
    try {
        const year = new Date().getFullYear();

        // Fetch dashboard overview + tickets in parallel
        const [dashRes, myTicketsRes, myApprovalsRes] = await Promise.all([
            fetch(`/api/teams/dashboard?userId=${currentUser.id}&year=${year}`),
            fetch(`/api/tickets?createdById=${currentUser.id}`),
            fetch(`/api/tickets?assignedApproverId=${currentUser.id}`)
        ]);

        if (!dashRes.ok) throw new Error('Failed to load dashboard data');

        const dashResult = await dashRes.json();
        dashboardData = dashResult.data;

        // Render overview cards
        renderOverviewCards(dashboardData);

        // Update ticket stats from API
        const stats = dashboardData.ticketStats;
        document.getElementById('pendingCount').textContent = stats.pending;
        document.getElementById('approvedCount').textContent = stats.approved;
        document.getElementById('rejectedCount').textContent = stats.rejected;

        // Load and render tickets
        if (myTicketsRes.ok && myApprovalsRes.ok) {
            const myTickets = (await myTicketsRes.json()).data || [];
            const myApprovals = (await myApprovalsRes.json()).data || [];

            allTickets = [...myTickets, ...myApprovals.filter(
                a => !myTickets.find(t => t.id === a.id)
            )];

            renderRequests(allTickets.slice(0, 10));
        }

    } catch (error) {
        console.error('Error loading dashboard:', error);
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

    // Sick days card
    const sickCard = document.getElementById('sickCard');
    sickCard.classList.remove('loading');
    if (quota) {
        const sickRemaining = quota.sick_days_remaining;
        const sickTotal = quota.sick_days_total;
        const sickUsedPct = Math.round((quota.sick_days_used / sickTotal) * 100);
        const barClass = sickUsedPct > 90 ? 'bar-red' : sickUsedPct > 70 ? 'bar-amber' : 'bar-green';

        document.getElementById('sickRemaining').textContent = `${sickRemaining} ${t('dashDays')}`;
        document.getElementById('sickDetail').textContent = `${quota.sick_days_used} / ${sickTotal} ${t('dashUsed')}`;
        const sickBar = document.getElementById('sickBar');
        sickBar.className = `overview-bar-fill ${barClass}`;
        sickBar.style.width = `${Math.min(sickUsedPct, 100)}%`;
    } else {
        document.getElementById('sickRemaining').textContent = '-';
        document.getElementById('sickDetail').textContent = t('dashNoQuota');
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
        'purchase': 'type-purchase',
        'expense': 'type-expense',
        'hr': 'type-hr',
        'other': 'type-other'
    };
    return classMap[type?.toLowerCase()] || 'type-other';
}

function translateTicketType(type) {
    const typeMap = {
        'vacation': 'typeVacation',
        'sick-leave': 'typeSickLeave',
        'purchase': 'typePurchase',
        'expense': 'typeExpense',
        'hr': 'typeHr',
        'other': 'typeOther'
    };
    return t(typeMap[type?.toLowerCase()] || 'typeOther');
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
