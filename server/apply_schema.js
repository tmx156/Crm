/**
 * Apply a .sql file to the Supabase Postgres database over a direct connection.
 *
 * DDL (create table / create index) cannot go through PostgREST, so neither the
 * anon nor the service_role key can do this — it needs a real Postgres session.
 * Set DATABASE_URL to the Session pooler connection string from the Supabase
 * dashboard (Connect -> Connection string -> Session pooler); the `db.<ref>`
 * direct host is IPv6-only and will not resolve here.
 *
 *   node server/apply_schema.js                        # applies 00_full_schema.sql
 *   node server/apply_schema.js migrations/other.sql   # applies a specific file
 *
 * The whole file runs inside one transaction: if any statement fails, nothing
 * is committed and the database is left untouched.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

const sqlArg = process.argv[2] || 'migrations/00_full_schema.sql';
const sqlPath = path.isAbsolute(sqlArg) ? sqlArg : path.join(__dirname, sqlArg);

(async () => {
  if (!DATABASE_URL || !DATABASE_URL.startsWith('postgres')) {
    console.error('❌ DATABASE_URL must be set to a Postgres connection string.');
    console.error('   Supabase dashboard -> Connect -> Connection string -> Session pooler');
    process.exit(1);
  }

  if (!fs.existsSync(sqlPath)) {
    console.error(`❌ SQL file not found: ${sqlPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const host = (() => {
    try { return new URL(DATABASE_URL).host; } catch { return '(unparseable)'; }
  })();

  console.log(`📄 File:   ${sqlPath}`);
  console.log(`🗄️  Host:   ${host}`);
  console.log(`📏 Size:   ${sql.length} bytes`);

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('🔌 Connected.');
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }

  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('✅ Applied successfully (committed).');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('❌ Failed, rolled back — no changes were made.');
    console.error(`   ${err.message}`);
    if (err.position) console.error(`   at character position ${err.position}`);
    await client.end();
    process.exit(1);
  }

  // Report what the database actually contains now, rather than assuming.
  const { rows } = await client.query(`
    select table_name,
           (select count(*) from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.table_name) as columns
      from information_schema.tables t
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `);

  console.log(`\n📋 public schema now has ${rows.length} table(s):`);
  for (const r of rows) console.log(`   - ${r.table_name} (${r.columns} columns)`);

  await client.end();
})();
