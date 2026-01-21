// Dashboard logic
let teamsContext = null;
let currentUser = null;
let allTickets = []; // Store tickets globally for re-rendering

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

// Load dashboard data
async function loadDashboardData() {
    try {
        // Fetch only MY tickets (created by me) and tickets assigned to me
        const myTicketsResponse = await fetch(`/api/tickets?createdById=${currentUser.id}`);
        const myApprovalsResponse = await fetch(`/api/tickets?assignedApproverId=${currentUser.id}`);

        if (!myTicketsResponse.ok || !myApprovalsResponse.ok) {
            throw new Error('Failed to load tickets');
        }

        const myTicketsResult = await myTicketsResponse.json();
        const myApprovalsResult = await myApprovalsResponse.json();

        const myTickets = myTicketsResult.data || [];
        const myApprovals = myApprovalsResult.data || [];

        // Combine and deduplicate tickets
        const allMyTickets = [...myTickets, ...myApprovals.filter(
            approval => !myTickets.find(ticket => ticket.id === approval.id)
        )];

        // Store tickets globally
        allTickets = allMyTickets;

        // Update stats (only my tickets)
        updateStats(allMyTickets);

        // Render recent requests (only my tickets)
        renderRequests(allMyTickets.slice(0, 10));

    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('requestsList').innerHTML = `
            <div class="error-message">
                <p>${t('errorLoadingDashboard')}: ${error.message}</p>
            </div>
        `;
    }
}

// Update statistics
function updateStats(tickets) {
    const stats = {
        pending: tickets.filter(t => t.status === 'Pending').length,
        approved: tickets.filter(t => t.status === 'Approved').length,
        rejected: tickets.filter(t => t.status === 'Rejected').length
    };

    document.getElementById('pendingCount').textContent = stats.pending;
    document.getElementById('approvedCount').textContent = stats.approved;
    document.getElementById('rejectedCount').textContent = stats.rejected;
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
                    ${ticket.priority === 'Urgent' ? '🔥' : ticket.priority === 'High' ? '⚠️' : ticket.priority === 'Low' ? '📌' : '📋'} ${t('labelPriorityLabel')}: ${translatePriority(ticket.priority)}
                </span>
                <span class="meta-item">
                    <strong>👤 ${t('labelCreatedBy')}:</strong> ${ticket.created_by_name}
                </span>
                ${(ticket.ticket_type === 'vacation' || ticket.ticket_type === 'sick-leave') && ticket.start_date && ticket.end_date ? `
                    <span class="meta-item">
                        <strong>📅</strong> ${formatDate(ticket.start_date)} → ${formatDate(ticket.end_date)}
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

// Helper function
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Helper function to get type badge class
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

// Helper function to translate ticket type
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

// Helper function to translate priority
function translatePriority(priority) {
    const priorityMap = {
        'low': 'priorityLow',
        'medium': 'priorityMedium',
        'high': 'priorityHigh',
        'urgent': 'priorityUrgent'
    };
    return t(priorityMap[priority?.toLowerCase()] || 'priorityMedium');
}

// Helper function to format date
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

// Override switchLanguage to re-render dashboard with new translations
const originalSwitchLanguage = window.switchLanguage;
window.switchLanguage = function(lang) {
    originalSwitchLanguage(lang);
    // Re-render stats and requests with new translations
    updateStats(allTickets);
    renderRequests(allTickets.slice(0, 10));
};
