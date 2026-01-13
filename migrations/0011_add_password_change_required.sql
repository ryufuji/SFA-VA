-- Add password_change_required flag to users table
ALTER TABLE users ADD COLUMN password_change_required INTEGER DEFAULT 0;

-- Set existing users with default passwords to require password change
-- Assuming initial passwords follow a pattern or you want to flag all existing users
UPDATE users SET password_change_required = 1 WHERE id > 0;
