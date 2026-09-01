-- Add hidden flag to users table
-- Hidden users won't appear in approver dropdown when creating requests
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT false;
