// Dashboard logic
let teamsContext = null;
let currentUser = null;

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
        // Fetch all tickets
        const response = await fetch('/api/tickets');
        
        if (!response.ok) {
            throw new Error('Failed to load tickets');
        }
        
        const result = await response.json();
        const tickets = result.data || [];

        // Update stats
        updateStats(tickets);

        // Render recent requests
        renderRequests(tickets.slice(0, 10));
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('requestsList').innerHTML = `
            <div class="error-message">
                <p>${t('alertError')} ${error.message}</p>
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
                <h3 class="request-title">${ticket.title}</h3>
                <span class="status-badge status-${ticket.status.toLowerCase()}">${t('status' + ticket.status)}</span>
            </div>
            <div class="request-meta">
                <span class="meta-item">
                    <strong>${t('labelType')}:</strong> ${t('type' + capitalizeFirst(ticket.ticket_type))}
                </span>
                <span class="meta-item">
                    <strong>${t('labelPriority')}:</strong> ${t('priority' + capitalizeFirst(ticket.priority))}
                </span>
                <span class="meta-item">
                    <strong>${t('labelCreatedBy')}:</strong> ${ticket.created_by_name}
                </span>
            </div>
            <p class="request-description">${ticket.description}</p>
        </div>
    `).join('');
}

// Helper function
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
