// Initialize Microsoft Teams SDK
let teamsContext = null;
let currentUser = null;

// Toggle date fields visibility based on ticket type
function toggleDateFields() {
    const ticketType = document.getElementById('ticketType').value;
    const dateRangeContainer = document.getElementById('dateRangeContainer');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');

    // Show date fields only for vacation and sick-leave
    if (ticketType === 'vacation' || ticketType === 'sick-leave') {
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
}

// Initialize app
(async function init() {
    try {
        await microsoftTeams.app.initialize();
        teamsContext = await microsoftTeams.app.getContext();
        currentUser = teamsContext.user;

        console.log('Teams context:', teamsContext);
        console.log('Current user:', currentUser);

        // Fetch current user info from Graph API to get displayName
        try {
            const userResponse = await fetch(`/api/users/${currentUser.id}`);
            if (userResponse.ok) {
                const userResult = await userResponse.json();
                // Merge Graph API data with Teams context
                currentUser = {
                    ...currentUser,
                    displayName: userResult.data.name,
                    graphEmail: userResult.data.email
                };
                console.log('Enhanced user info from Graph:', currentUser);
            }
        } catch (error) {
            console.warn('Could not fetch user from Graph API, using Teams context only:', error);
        }

        // Load approvers list
        await loadApprovers();

    } catch (error) {
        console.error('Error initializing Teams:', error);
        showAlert(t('alertErrorInit'), 'error');
    }
})();

// Load list of approvers (managers)
async function loadApprovers() {
    const approverSelect = document.getElementById('approver');

    try {
        // Fetch users from Microsoft Graph API
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
        showAlert(t('alertErrorLoading'), 'error');
    }
}

// Handle form submission
document.getElementById('approvalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');
    
    // Disable button and show loader
    submitBtn.disabled = true;
    btnText.textContent = t('btnSubmitting');
    btnLoader.style.display = 'inline-block';
    
    try {
        // Get form data
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
        
        console.log('Submitting ticket:', ticketData);
        
        // Send to API
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
        console.log('Ticket created:', result);

        // Show success message
        showAlert(t('alertSuccess'), 'success');

        // Refresh approval badge count for the approver
        if (window.refreshApprovalsBadge) {
            window.refreshApprovalsBadge();
        }

        // Reset form
        e.target.reset();

        // Reload approvers select with translated placeholder
        await loadApprovers();
        
        // Optionally close the task module or navigate
        setTimeout(() => {
            if (microsoftTeams.tasks) {
                microsoftTeams.tasks.submitTask({ success: true });
            }
        }, 2000);
        
    } catch (error) {
        console.error('Error submitting ticket:', error);
        showAlert(t('alertError') + error.message, 'error');
    } finally {
        // Re-enable button
        submitBtn.disabled = false;
        btnText.textContent = t('btnSubmit');
        btnLoader.style.display = 'none';
    }
});

// Show alert message
function showAlert(message, type = 'success') {
    const alertContainer = document.getElementById('alertContainer');
    
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.innerHTML = `
        <span class="alert-icon">${type === 'success' ? '✓' : '✗'}</span>
        <span>${message}</span>
    `;
    
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        alert.remove();
    }, 5000);
}
