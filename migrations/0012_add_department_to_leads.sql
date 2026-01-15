-- Update leads table unique constraint to company_name + department combination
-- Create unique index for company_name and department combination
-- Note: NULL values in department are treated as distinct, so each company can have multiple NULL departments
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_company_department ON leads(company_name, COALESCE(department, ''));

