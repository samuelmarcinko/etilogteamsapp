-- Create database schema for Teams Approval App

-- Users table (optional cache of Teams users)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    ticket_type VARCHAR(50) DEFAULT 'Other',
    priority VARCHAR(20) DEFAULT 'Medium',
    status VARCHAR(20) DEFAULT 'Pending',
    created_by_id VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_by_email VARCHAR(255) NOT NULL,
    assigned_approver_id VARCHAR(255),
    assigned_approver_name VARCHAR(255),
    assigned_approver_email VARCHAR(255),
    conversation_id VARCHAR(255),
    activity_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_status CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    CONSTRAINT chk_ticket_type CHECK (ticket_type IN ('vacation', 'purchase', 'expense', 'hr', 'other', 'HR', 'Accounting', 'Other')),
    CONSTRAINT chk_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent', 'Low', 'Medium', 'High', 'Urgent'))
);

-- Ticket actions table (audit log)
CREATE TABLE IF NOT EXISTS ticket_actions (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    performed_by_id VARCHAR(255) NOT NULL,
    performed_by_name VARCHAR(255) NOT NULL,
    performed_by_email VARCHAR(255) NOT NULL,
    rejection_reason TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE CASCADE,
    CONSTRAINT chk_action CHECK (action IN ('Created', 'Approved', 'Rejected', 'Viewed'))
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_approver_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_actions_ticket_id ON ticket_actions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_actions_timestamp ON ticket_actions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
