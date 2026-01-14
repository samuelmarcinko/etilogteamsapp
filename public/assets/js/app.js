// Initialize Microsoft Teams SDK
let teamsContext = null;
let currentUser = null;

// Initialize app
(async function init() {
    try {
        await microsoftTeams.app.initialize();
        teamsContext = await microsoftTeams.app.getContext();
        currentUser = teamsContext.user;
        
        console.log('Teams context:', teamsContext);
        console.log('Current user:', currentUser);
        
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
        // TODO: Replace with actual API call to get users from Azure AD
        // For now, using static list
        const approvers = [
            { id: 'manager1-aad-id', name: 'Peter Kováč', email: 'peter.kovac@etilog.com' },
            { id: 'manager2-aad-id', name: 'Mária Nováková', email: 'maria.novakova@etilog.com' },
            { id: 'manager3-aad-id', name: 'Ján Horváth', email: 'jan.horvath@etilog.com' }
        ];
        
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
            created_by_name: currentUser?.userPrincipalName || 'Unknown User',
            created_by_email: currentUser?.userPrincipalName || 'unknown@etilog.com',
            assigned_approver_id: approverData.id,
            assigned_approver_name: approverData.name,
            assigned_approver_email: approverData.email
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
