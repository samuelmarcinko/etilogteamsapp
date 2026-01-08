# Database Schema Documentation

Complete database schema reference for the Teams Approval App.

## Overview

The database uses PostgreSQL and consists of three main tables:
- `tickets` - Main ticket information
- `ticket_actions` - Audit log of all ticket actions
- `users` - Optional cache of Teams users

## Entity Relationship Diagram

```
┌─────────────────┐
│     users       │
│ (optional)      │
└─────────────────┘
        │
        │ (referenced by user_id)
        │
        ▼
┌─────────────────┐       ┌──────────────────┐
│    tickets      │◄──────│  ticket_actions  │
│                 │  1:N  │  (audit log)     │
└─────────────────┘       └──────────────────┘
```

## Tables

### tickets

Main table storing all approval tickets.

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto | Primary key |
| ticket_id | VARCHAR(50) | NO | unique | Human-readable ticket ID (e.g., TKT-ABC123) |
| title | VARCHAR(500) | NO | - | Ticket title |
| description | TEXT | NO | - | Detailed description |
| ticket_type | VARCHAR(50) | NO | 'Other' | HR, Accounting, or Other |
| priority | VARCHAR(20) | NO | 'Medium' | Low, Medium, or High |
| status | VARCHAR(20) | NO | 'Pending' | Pending, Approved, or Rejected |
| created_by_id | VARCHAR(255) | NO | - | Azure AD Object ID of creator |
| created_by_name | VARCHAR(255) | NO | - | Display name of creator |
| created_by_email | VARCHAR(255) | NO | - | Email of creator |
| assigned_approver_id | VARCHAR(255) | YES | NULL | Azure AD Object ID of approver |
| assigned_approver_name | VARCHAR(255) | YES | NULL | Display name of approver |
| assigned_approver_email | VARCHAR(255) | YES | NULL | Email of approver |
| conversation_id | VARCHAR(255) | YES | NULL | Teams conversation ID |
| activity_id | VARCHAR(255) | YES | NULL | Teams activity ID for card |
| created_at | TIMESTAMP | NO | CURRENT_TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | NO | CURRENT_TIMESTAMP | Last update timestamp |

**Constraints:**

```sql
PRIMARY KEY (id)
UNIQUE (ticket_id)
CHECK (status IN ('Pending', 'Approved', 'Rejected'))
CHECK (ticket_type IN ('HR', 'Accounting', 'Other'))
CHECK (priority IN ('Low', 'Medium', 'High'))
```

**Indexes:**

```sql
idx_tickets_status ON tickets(status)
idx_tickets_created_by ON tickets(created_by_id)
idx_tickets_assigned_to ON tickets(assigned_approver_id)
idx_tickets_created_at ON tickets(created_at DESC)
```

**Triggers:**

```sql
-- Auto-update updated_at on row update
CREATE TRIGGER update_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**Example Row:**

```sql
{
  "id": 1,
  "ticket_id": "TKT-ABC123",
  "title": "Approve New Hire",
  "description": "Please approve John Doe for Software Engineer position",
  "ticket_type": "HR",
  "priority": "High",
  "status": "Pending",
  "created_by_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "created_by_name": "Jane Smith",
  "created_by_email": "jane.smith@company.com",
  "assigned_approver_id": "x9y8z7w6-v5u4-3210-zyxw-vu9876543210",
  "assigned_approver_name": "Bob Manager",
  "assigned_approver_email": "bob.manager@company.com",
  "conversation_id": "19:meeting_abc123...",
  "activity_id": "1234567890123",
  "created_at": "2024-01-08T10:30:00.000Z",
  "updated_at": "2024-01-08T10:30:00.000Z"
}
```

---

### ticket_actions

Audit log table storing all actions performed on tickets. This table is append-only (immutable).

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto | Primary key |
| ticket_id | VARCHAR(50) | NO | - | Reference to tickets.ticket_id |
| action | VARCHAR(50) | NO | - | Action performed |
| performed_by_id | VARCHAR(255) | NO | - | Azure AD Object ID of user |
| performed_by_name | VARCHAR(255) | NO | - | Display name of user |
| performed_by_email | VARCHAR(255) | NO | - | Email of user |
| rejection_reason | TEXT | YES | NULL | Reason if action was rejection |
| timestamp | TIMESTAMP | NO | CURRENT_TIMESTAMP | When action occurred |

**Constraints:**

```sql
PRIMARY KEY (id)
FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE CASCADE
CHECK (action IN ('Created', 'Approved', 'Rejected', 'Viewed'))
```

**Indexes:**

```sql
idx_ticket_actions_ticket_id ON ticket_actions(ticket_id)
idx_ticket_actions_timestamp ON ticket_actions(timestamp DESC)
```

**Example Rows:**

```sql
-- Creation action
{
  "id": 1,
  "ticket_id": "TKT-ABC123",
  "action": "Created",
  "performed_by_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "performed_by_name": "Jane Smith",
  "performed_by_email": "jane.smith@company.com",
  "rejection_reason": null,
  "timestamp": "2024-01-08T10:30:00.000Z"
}

-- Approval action
{
  "id": 2,
  "ticket_id": "TKT-ABC123",
  "action": "Approved",
  "performed_by_id": "x9y8z7w6-v5u4-3210-zyxw-vu9876543210",
  "performed_by_name": "Bob Manager",
  "performed_by_email": "bob.manager@company.com",
  "rejection_reason": null,
  "timestamp": "2024-01-08T12:00:00.000Z"
}

-- Rejection action
{
  "id": 3,
  "ticket_id": "TKT-DEF456",
  "action": "Rejected",
  "performed_by_id": "x9y8z7w6-v5u4-3210-zyxw-vu9876543210",
  "performed_by_name": "Bob Manager",
  "performed_by_email": "bob.manager@company.com",
  "rejection_reason": "Need more information about budget",
  "timestamp": "2024-01-08T13:00:00.000Z"
}
```

---

### users

Optional table for caching user information from Teams/Azure AD.

**Columns:**

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto | Primary key |
| user_id | VARCHAR(255) | NO | unique | Azure AD Object ID |
| email | VARCHAR(255) | NO | - | User email |
| display_name | VARCHAR(255) | YES | NULL | User display name |
| role | VARCHAR(50) | NO | 'user' | User role (user, hr, manager, admin) |
| created_at | TIMESTAMP | NO | CURRENT_TIMESTAMP | First seen timestamp |
| updated_at | TIMESTAMP | NO | CURRENT_TIMESTAMP | Last update timestamp |

**Constraints:**

```sql
PRIMARY KEY (id)
UNIQUE (user_id)
```

**Indexes:**

```sql
idx_users_user_id ON users(user_id)
```

**Triggers:**

```sql
-- Auto-update updated_at on row update
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**Example Row:**

```sql
{
  "id": 1,
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "jane.smith@company.com",
  "display_name": "Jane Smith",
  "role": "hr",
  "created_at": "2024-01-08T10:00:00.000Z",
  "updated_at": "2024-01-08T10:00:00.000Z"
}
```

---

## Common Queries

### Get all pending tickets

```sql
SELECT * FROM tickets
WHERE status = 'Pending'
ORDER BY created_at DESC;
```

### Get tickets for specific user

```sql
SELECT * FROM tickets
WHERE created_by_id = 'user-aad-id'
ORDER BY created_at DESC;
```

### Get tickets assigned to manager

```sql
SELECT * FROM tickets
WHERE assigned_approver_id = 'manager-aad-id'
  AND status = 'Pending'
ORDER BY priority DESC, created_at ASC;
```

### Get ticket with full audit trail

```sql
SELECT
  t.*,
  json_agg(
    json_build_object(
      'action', ta.action,
      'performed_by', ta.performed_by_name,
      'timestamp', ta.timestamp,
      'rejection_reason', ta.rejection_reason
    ) ORDER BY ta.timestamp ASC
  ) as audit_trail
FROM tickets t
LEFT JOIN ticket_actions ta ON t.ticket_id = ta.ticket_id
WHERE t.ticket_id = 'TKT-ABC123'
GROUP BY t.id;
```

### Get ticket statistics

```sql
SELECT
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_hours_to_process
FROM tickets
WHERE status IN ('Approved', 'Rejected')
GROUP BY status;
```

### Get manager approval rate

```sql
SELECT
  assigned_approver_name as manager,
  COUNT(*) as total_tickets,
  SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved,
  SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected,
  ROUND(
    100.0 * SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) / COUNT(*),
    2
  ) as approval_rate
FROM tickets
WHERE status IN ('Approved', 'Rejected')
  AND assigned_approver_id IS NOT NULL
GROUP BY assigned_approver_id, assigned_approver_name
ORDER BY total_tickets DESC;
```

### Get recent activity

```sql
SELECT
  ta.ticket_id,
  t.title,
  ta.action,
  ta.performed_by_name,
  ta.timestamp
FROM ticket_actions ta
JOIN tickets t ON ta.ticket_id = t.ticket_id
ORDER BY ta.timestamp DESC
LIMIT 20;
```

---

## Backup and Restore

### Backup Database

```bash
# Full backup
pg_dump -U approval_user -d teams_approval -F c -f backup.dump

# SQL format backup
pg_dump -U approval_user -d teams_approval -f backup.sql

# Compressed backup
pg_dump -U approval_user teams_approval | gzip > backup.sql.gz
```

### Restore Database

```bash
# From custom format
pg_restore -U approval_user -d teams_approval backup.dump

# From SQL file
psql -U approval_user -d teams_approval -f backup.sql

# From compressed SQL
gunzip -c backup.sql.gz | psql -U approval_user -d teams_approval
```

### Backup Single Table

```bash
pg_dump -U approval_user -d teams_approval -t ticket_actions -f audit_backup.sql
```

---

## Maintenance

### Vacuum and Analyze

```sql
-- Vacuum all tables
VACUUM ANALYZE tickets;
VACUUM ANALYZE ticket_actions;
VACUUM ANALYZE users;

-- Or vacuum entire database
VACUUM ANALYZE;
```

### Check Table Sizes

```sql
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Check Index Usage

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

---

## Data Retention

### Archive Old Tickets

```sql
-- Create archive table (one-time)
CREATE TABLE tickets_archive (LIKE tickets INCLUDING ALL);
CREATE TABLE ticket_actions_archive (LIKE ticket_actions INCLUDING ALL);

-- Move tickets older than 1 year to archive
WITH moved_tickets AS (
  DELETE FROM tickets
  WHERE created_at < NOW() - INTERVAL '1 year'
  RETURNING *
)
INSERT INTO tickets_archive SELECT * FROM moved_tickets;

-- Move related actions
WITH moved_actions AS (
  DELETE FROM ticket_actions
  WHERE ticket_id IN (SELECT ticket_id FROM tickets_archive)
  RETURNING *
)
INSERT INTO ticket_actions_archive SELECT * FROM moved_actions;
```

### Delete Old Data (Use with Caution!)

```sql
-- Delete rejected tickets older than 6 months
DELETE FROM tickets
WHERE status = 'Rejected'
  AND updated_at < NOW() - INTERVAL '6 months';

-- This will cascade delete related ticket_actions
```

---

## Performance Tuning

### Add Additional Indexes (if needed)

```sql
-- Index for filtering by ticket type and status
CREATE INDEX idx_tickets_type_status ON tickets(ticket_type, status);

-- Index for date range queries
CREATE INDEX idx_tickets_created_at_range ON tickets(created_at)
WHERE status = 'Pending';

-- Partial index for pending tickets only
CREATE INDEX idx_tickets_pending ON tickets(assigned_approver_id, created_at)
WHERE status = 'Pending';
```

### Query Optimization Tips

1. **Use EXPLAIN ANALYZE** to understand query performance:
```sql
EXPLAIN ANALYZE
SELECT * FROM tickets WHERE status = 'Pending';
```

2. **Avoid SELECT *** - Select only needed columns:
```sql
-- Good
SELECT ticket_id, title, status FROM tickets;

-- Avoid
SELECT * FROM tickets;
```

3. **Use pagination** for large result sets:
```sql
SELECT * FROM tickets
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;
```

---

## Security Considerations

### Row-Level Security (Optional)

```sql
-- Enable RLS on tickets table
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own tickets
CREATE POLICY user_own_tickets ON tickets
  FOR SELECT
  USING (created_by_id = current_setting('app.user_id')::text);

-- Policy: Managers can see assigned tickets
CREATE POLICY manager_assigned_tickets ON tickets
  FOR SELECT
  USING (assigned_approver_id = current_setting('app.user_id')::text);
```

### Database User Permissions

```sql
-- Create read-only user for reporting
CREATE USER readonly_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE teams_approval TO readonly_user;
GRANT USAGE ON SCHEMA public TO readonly_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
```

---

## Migration Strategy

When schema changes are needed:

1. Create migration script in `src/database/migrations/`
2. Test on development database
3. Backup production database
4. Run migration on production
5. Verify data integrity

Example migration script structure:

```sql
-- Migration: 001_add_ticket_category.sql
BEGIN;

-- Add new column
ALTER TABLE tickets ADD COLUMN category VARCHAR(50);

-- Set default value for existing rows
UPDATE tickets SET category = 'General' WHERE category IS NULL;

-- Make column NOT NULL
ALTER TABLE tickets ALTER COLUMN category SET NOT NULL;

COMMIT;
```

---

## Troubleshooting

### Check Database Connections

```sql
SELECT * FROM pg_stat_activity WHERE datname = 'teams_approval';
```

### Kill Long-Running Queries

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'teams_approval'
  AND state = 'active'
  AND query_start < NOW() - INTERVAL '10 minutes';
```

### Check for Locks

```sql
SELECT * FROM pg_locks WHERE NOT granted;
```

### Database Stats

```sql
SELECT * FROM pg_stat_database WHERE datname = 'teams_approval';
```
