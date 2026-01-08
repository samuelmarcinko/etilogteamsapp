# Teams Approval App

Internal Microsoft Teams application for HR and Accounting approval workflows using Adaptive Cards.

## Overview

The Teams Approval App allows HR and Accounting staff to submit approval tickets that managers can approve or reject directly inside Microsoft Teams with one-click actions. The application uses Adaptive Cards for an interactive experience and integrates seamlessly with Microsoft 365 authentication.

## Features

- **Ticket Creation**: HR/Accounting staff can create approval tickets with title, description, type, and priority
- **Adaptive Cards**: Managers receive interactive cards in Teams with approve/reject buttons
- **One-Click Actions**: Approve or reject tickets without leaving Teams
- **Notifications**: Automatic notifications sent to ticket creators on approval/rejection
- **Audit Trail**: Complete logging of all actions (create, approve, reject)
- **Azure AD Integration**: Seamless authentication using Microsoft Entra ID (Azure AD)
- **Role-Based Access**: Support for different user roles (HR, Accounting, Manager)

## Technology Stack

- **Backend**: Node.js with Express
- **Database**: PostgreSQL
- **Bot Framework**: Microsoft Bot Framework SDK
- **Authentication**: Azure AD / Microsoft Entra ID
- **Cards**: Microsoft Adaptive Cards
- **Deployment**: VPS (Hetzner recommended)

## Architecture

```
┌─────────────────┐
│  Microsoft      │
│  Teams Client   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Bot Framework  │
│  Connector      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│  Express API    │◄────►│  PostgreSQL  │
│  (Node.js)      │      │  Database    │
└─────────────────┘      └──────────────┘
         │
         ▼
┌─────────────────┐
│  Azure AD /     │
│  Entra ID       │
└─────────────────┘
```

## Prerequisites

- Node.js 16.x or higher
- PostgreSQL 12.x or higher
- Microsoft 365 Business Standard or higher
- Azure AD tenant access
- Microsoft Teams Admin Center access
- VPS server with public IP and domain

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd etilogteamsapp
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your settings (see Configuration section below).

### 3. Set Up Database

```bash
# Create PostgreSQL database
createdb teams_approval

# Run migrations
npm run migrate
```

### 4. Register Bot in Azure

See [SETUP.md](./docs/SETUP.md) for detailed instructions on:
- Creating Azure Bot Registration
- Configuring OAuth settings
- Setting up bot messaging endpoint

### 5. Start the Server

```bash
# Development
npm run dev

# Production
npm start
```

### 6. Deploy Teams App

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for instructions on:
- Preparing the Teams manifest
- Creating app package
- Uploading to Teams Admin Center

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3978) | No |
| `NODE_ENV` | Environment (development/production) | No |
| `MICROSOFT_APP_ID` | Azure Bot App ID | Yes |
| `MICROSOFT_APP_PASSWORD` | Azure Bot App Password | Yes |
| `TENANT_ID` | Azure AD Tenant ID | Yes |
| `CLIENT_ID` | Azure AD Client ID | Yes |
| `CLIENT_SECRET` | Azure AD Client Secret | Yes |
| `DB_HOST` | PostgreSQL host | Yes |
| `DB_PORT` | PostgreSQL port | Yes |
| `DB_NAME` | Database name | Yes |
| `DB_USER` | Database user | Yes |
| `DB_PASSWORD` | Database password | Yes |
| `APP_BASE_URL` | Your server URL (https://...) | Yes |

## API Endpoints

### Authentication

All API endpoints require Bearer token authentication with Azure AD token.

```
Authorization: Bearer <azure-ad-token>
```

### Tickets

#### Create Ticket
```http
POST /api/tickets
Content-Type: application/json

{
  "title": "Approve New Hire",
  "description": "Please approve John Doe for Software Engineer position",
  "ticketType": "HR",
  "priority": "High",
  "assignedApprover": {
    "id": "user-aad-id",
    "name": "Manager Name",
    "email": "manager@company.com"
  }
}
```

#### Get All Tickets
```http
GET /api/tickets?status=Pending&createdById=user-id
```

#### Get My Tickets
```http
GET /api/tickets/my/tickets
```

#### Get Assigned Tickets
```http
GET /api/tickets/assigned/me
```

#### Approve Ticket
```http
POST /api/tickets/{ticketId}/approve
```

#### Reject Ticket
```http
POST /api/tickets/{ticketId}/reject
Content-Type: application/json

{
  "rejectionReason": "Additional information needed"
}
```

#### Get Audit Log
```http
GET /api/tickets/{ticketId}/audit
```

See [API.md](./docs/API.md) for complete API documentation.

## User Workflows

### HR/Accounting Staff

1. Create approval ticket via API or custom interface
2. Ticket is stored in database
3. Adaptive Card is sent to assigned manager
4. Receive notification when ticket is approved/rejected

### Manager

1. Receive Adaptive Card in Teams (DM or channel)
2. Review ticket details
3. Click "Approve" or "Reject"
4. Optionally add rejection reason
5. Card updates to show final status

## Database Schema

### Tables

- **tickets**: Main ticket information
- **ticket_actions**: Audit log of all actions
- **users**: User cache (optional)

See [DATABASE.md](./docs/DATABASE.md) for complete schema documentation.

## Security

- **Authentication**: Azure AD OAuth 2.0
- **Authorization**: Role-based access control
- **Data Protection**: All sensitive data encrypted in transit (HTTPS)
- **Audit Trail**: Immutable logs of all actions
- **Token Validation**: JWT signature verification with JWKS

## Monitoring and Logging

- Request logging to console
- Error tracking with stack traces
- Database connection monitoring
- Bot Framework activity logging

## Development

### Project Structure

```
etilogteamsapp/
├── src/
│   ├── bot/              # Bot Framework integration
│   ├── cards/            # Adaptive Card templates
│   ├── controllers/      # API controllers
│   ├── database/         # Database config and models
│   ├── middleware/       # Express middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   └── index.js          # Main entry point
├── teams-manifest/       # Teams app manifest
├── scripts/              # Utility scripts
├── docs/                 # Documentation
├── .env.example          # Environment template
├── package.json          # Dependencies
└── README.md            # This file
```

### Running Tests

```bash
npm test
```

### Database Migrations

```bash
npm run migrate
```

## Troubleshooting

### Bot Not Responding

1. Check bot endpoint is accessible: `https://your-server.com/api/messages`
2. Verify MICROSOFT_APP_ID and MICROSOFT_APP_PASSWORD are correct
3. Check bot is registered in Azure Portal
4. Ensure SSL certificate is valid

### Authentication Failing

1. Verify TENANT_ID is correct
2. Check CLIENT_ID and CLIENT_SECRET
3. Ensure user has proper permissions in Azure AD
4. Verify token audience matches CLIENT_ID

### Database Connection Issues

1. Check PostgreSQL is running
2. Verify database credentials in .env
3. Ensure database exists and migrations ran
4. Check network connectivity

See [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) for more details.

## Support

For issues and questions:
- Check [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
- Review [FAQ.md](./docs/FAQ.md)
- Contact your IT administrator

## License

MIT License - Internal use only

## Contributors

Your Company IT Team
