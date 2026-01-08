# API Documentation

Complete API reference for the Teams Approval App.

## Base URL

```
https://your-server.com/api
```

## Authentication

All API endpoints (except health check) require authentication using Azure AD Bearer token.

### Getting a Token

Use Azure AD authentication to obtain a token:

```javascript
// Example using MSAL.js
const token = await msalInstance.acquireTokenSilent({
  scopes: ['api://your-app-id/.default']
});

// Use in requests
fetch('/api/tickets', {
  headers: {
    'Authorization': `Bearer ${token.accessToken}`
  }
});
```

### Request Headers

```
Authorization: Bearer <azure-ad-token>
Content-Type: application/json
```

## Endpoints

### Health Check

Check if the API is running.

```http
GET /api/health
```

**Authentication**: Not required

**Response**:
```json
{
  "status": "OK",
  "timestamp": "2024-01-08T10:30:00.000Z",
  "service": "Teams Approval App"
}
```

---

### Create Ticket

Create a new approval ticket.

```http
POST /api/tickets
```

**Authentication**: Required

**Request Body**:
```json
{
  "title": "Approve New Hire",
  "description": "Please approve John Doe for Software Engineer position. Start date: Feb 1, 2024. Salary: $90,000.",
  "ticketType": "HR",
  "priority": "High",
  "assignedApprover": {
    "id": "aad-object-id",
    "name": "Jane Manager",
    "email": "jane.manager@company.com"
  },
  "conversationId": "optional-channel-id"
}
```

**Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | Yes | Ticket title (max 500 chars) |
| description | string | Yes | Detailed description |
| ticketType | string | No | HR, Accounting, or Other (default: Other) |
| priority | string | No | Low, Medium, or High (default: Medium) |
| assignedApprover | object | No | Manager to approve ticket |
| assignedApprover.id | string | No | Azure AD Object ID |
| assignedApprover.name | string | No | Manager name |
| assignedApprover.email | string | No | Manager email |
| conversationId | string | No | Teams channel ID to send card |

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Ticket created successfully",
  "data": {
    "id": 1,
    "ticket_id": "TKT-ABC123",
    "title": "Approve New Hire",
    "description": "Please approve John Doe...",
    "ticket_type": "HR",
    "priority": "High",
    "status": "Pending",
    "created_by_id": "user-aad-id",
    "created_by_name": "John Creator",
    "created_by_email": "john@company.com",
    "assigned_approver_id": "manager-aad-id",
    "assigned_approver_name": "Jane Manager",
    "assigned_approver_email": "jane.manager@company.com",
    "created_at": "2024-01-08T10:30:00.000Z",
    "updated_at": "2024-01-08T10:30:00.000Z"
  }
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "Bad Request",
  "message": "Title and description are required"
}
```

---

### Get All Tickets

Retrieve all tickets with optional filters.

```http
GET /api/tickets?status=Pending&createdById=user-id
```

**Authentication**: Required

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status (Pending, Approved, Rejected) |
| createdById | string | Filter by creator Azure AD ID |
| assignedApproverId | string | Filter by approver Azure AD ID |

**Response** (200 OK):
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": 1,
      "ticket_id": "TKT-ABC123",
      "title": "Approve New Hire",
      "status": "Pending",
      "created_at": "2024-01-08T10:30:00.000Z",
      ...
    },
    {
      "id": 2,
      "ticket_id": "TKT-DEF456",
      "title": "Budget Approval",
      "status": "Pending",
      "created_at": "2024-01-08T11:00:00.000Z",
      ...
    }
  ]
}
```

---

### Get My Tickets

Get tickets created by the authenticated user.

```http
GET /api/tickets/my/tickets
```

**Authentication**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "count": 3,
  "data": [...]
}
```

---

### Get Assigned Tickets

Get pending tickets assigned to the authenticated user for approval.

```http
GET /api/tickets/assigned/me
```

**Authentication**: Required

**Response** (200 OK):
```json
{
  "success": true,
  "count": 5,
  "data": [...]
}
```

---

### Get Ticket by ID

Retrieve a specific ticket.

```http
GET /api/tickets/:ticketId
```

**Authentication**: Required

**URL Parameters**:
- `ticketId` - The ticket ID (e.g., TKT-ABC123)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": 1,
    "ticket_id": "TKT-ABC123",
    "title": "Approve New Hire",
    "description": "Please approve John Doe...",
    "ticket_type": "HR",
    "priority": "High",
    "status": "Pending",
    ...
  }
}
```

**Error Response** (404 Not Found):
```json
{
  "error": "Not Found",
  "message": "Ticket not found"
}
```

---

### Approve Ticket

Approve a ticket.

```http
POST /api/tickets/:ticketId/approve
```

**Authentication**: Required

**URL Parameters**:
- `ticketId` - The ticket ID (e.g., TKT-ABC123)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Ticket approved successfully",
  "data": {
    "id": 1,
    "ticket_id": "TKT-ABC123",
    "status": "Approved",
    "updated_at": "2024-01-08T12:00:00.000Z",
    ...
  }
}
```

**Error Responses**:

400 Bad Request:
```json
{
  "error": "Bad Request",
  "message": "Ticket has already been processed"
}
```

404 Not Found:
```json
{
  "error": "Not Found",
  "message": "Ticket not found"
}
```

---

### Reject Ticket

Reject a ticket with optional reason.

```http
POST /api/tickets/:ticketId/reject
```

**Authentication**: Required

**URL Parameters**:
- `ticketId` - The ticket ID (e.g., TKT-ABC123)

**Request Body**:
```json
{
  "rejectionReason": "Additional information needed before approval"
}
```

**Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| rejectionReason | string | No | Reason for rejection (max 500 chars) |

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Ticket rejected successfully",
  "data": {
    "id": 1,
    "ticket_id": "TKT-ABC123",
    "status": "Rejected",
    "updated_at": "2024-01-08T12:00:00.000Z",
    ...
  }
}
```

---

### Get Audit Log

Get the audit log for a ticket.

```http
GET /api/tickets/:ticketId/audit
```

**Authentication**: Required

**URL Parameters**:
- `ticketId` - The ticket ID (e.g., TKT-ABC123)

**Response** (200 OK):
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": 1,
      "ticket_id": "TKT-ABC123",
      "action": "Created",
      "performed_by_id": "user-aad-id",
      "performed_by_name": "John Creator",
      "performed_by_email": "john@company.com",
      "rejection_reason": null,
      "timestamp": "2024-01-08T10:30:00.000Z"
    },
    {
      "id": 2,
      "ticket_id": "TKT-ABC123",
      "action": "Approved",
      "performed_by_id": "manager-aad-id",
      "performed_by_name": "Jane Manager",
      "performed_by_email": "jane.manager@company.com",
      "rejection_reason": null,
      "timestamp": "2024-01-08T12:00:00.000Z"
    }
  ]
}
```

---

## Error Handling

All errors follow this format:

```json
{
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## Rate Limiting

Currently no rate limiting is implemented. This may be added in future versions.

---

## Webhooks

Webhooks are not currently supported but may be added in future versions to notify external systems of ticket events.

---

## Example Usage

### JavaScript/TypeScript

```typescript
const API_BASE = 'https://your-server.com/api';
const token = 'your-azure-ad-token';

// Create ticket
async function createTicket() {
  const response = await fetch(`${API_BASE}/tickets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Approve Equipment Purchase',
      description: 'Need approval for new laptop',
      ticketType: 'Accounting',
      priority: 'Medium',
      assignedApprover: {
        id: 'manager-id',
        name: 'Manager Name',
        email: 'manager@company.com'
      }
    })
  });

  const data = await response.json();
  console.log('Ticket created:', data);
}

// Get my tickets
async function getMyTickets() {
  const response = await fetch(`${API_BASE}/tickets/my/tickets`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  console.log('My tickets:', data);
}

// Approve ticket
async function approveTicket(ticketId) {
  const response = await fetch(`${API_BASE}/tickets/${ticketId}/approve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  console.log('Ticket approved:', data);
}
```

### Python

```python
import requests

API_BASE = 'https://your-server.com/api'
token = 'your-azure-ad-token'

headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

# Create ticket
def create_ticket():
    data = {
        'title': 'Approve Equipment Purchase',
        'description': 'Need approval for new laptop',
        'ticketType': 'Accounting',
        'priority': 'Medium',
        'assignedApprover': {
            'id': 'manager-id',
            'name': 'Manager Name',
            'email': 'manager@company.com'
        }
    }

    response = requests.post(
        f'{API_BASE}/tickets',
        headers=headers,
        json=data
    )

    return response.json()

# Get assigned tickets
def get_assigned_tickets():
    response = requests.get(
        f'{API_BASE}/tickets/assigned/me',
        headers=headers
    )

    return response.json()
```

### cURL

```bash
# Set variables
API_BASE="https://your-server.com/api"
TOKEN="your-azure-ad-token"

# Create ticket
curl -X POST "$API_BASE/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Approve Budget Request",
    "description": "Q1 marketing budget approval needed",
    "ticketType": "Accounting",
    "priority": "High"
  }'

# Get all tickets
curl -X GET "$API_BASE/tickets?status=Pending" \
  -H "Authorization: Bearer $TOKEN"

# Approve ticket
curl -X POST "$API_BASE/tickets/TKT-ABC123/approve" \
  -H "Authorization: Bearer $TOKEN"

# Reject ticket
curl -X POST "$API_BASE/tickets/TKT-ABC123/reject" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rejectionReason": "Insufficient budget"}'
```

---

## Pagination

Currently not implemented. All queries return all matching results. This may be added in future versions for large datasets.

---

## Versioning

API version is not currently included in the URL. Future versions may use `/api/v1/` prefix.
