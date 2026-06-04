-- Enable Row Level Security on the sales table
-- This blocks direct inserts/updates/deletes via the anon key
-- The server uses the service_role key which bypasses RLS

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- Allow anon key to READ sales (needed for client-side display)
CREATE POLICY "Allow read access for authenticated users" ON sales
  FOR SELECT
  USING (true);

-- Block ALL inserts via anon key - sales must go through the server API
CREATE POLICY "Block direct inserts via anon key" ON sales
  FOR INSERT
  WITH CHECK (false);

-- Block ALL updates via anon key
CREATE POLICY "Block direct updates via anon key" ON sales
  FOR UPDATE
  USING (false);

-- Block ALL deletes via anon key
CREATE POLICY "Block direct deletes via anon key" ON sales
  FOR DELETE
  USING (false);

-- Also enable RLS on leads table to prevent direct tampering
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access for leads" ON leads
  FOR SELECT
  USING (true);

CREATE POLICY "Block direct inserts on leads" ON leads
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Block direct updates on leads" ON leads
  FOR UPDATE
  USING (false);

CREATE POLICY "Block direct deletes on leads" ON leads
  FOR DELETE
  USING (false);
