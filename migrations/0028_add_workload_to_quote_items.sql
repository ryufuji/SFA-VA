-- Add workload column to quote_items table
ALTER TABLE quote_items ADD COLUMN workload REAL DEFAULT 1.0;

-- Update existing records to have workload = 1.0
UPDATE quote_items SET workload = 1.0 WHERE workload IS NULL;
