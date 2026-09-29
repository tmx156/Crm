/**
 * Run a .sql file against this project's Supabase database.
 *
 *   DB_PASSWORD=your-db-password node apply_sql.js migrations/add-photos-and-read-receipts.sql
 *
 * The database password is the one set when the Supabase project was created
 * (Dashboard -> Project Settings -> Database -> Database password). It is
 * deliberately not stored in .env - pass it on the command line so it never
 * lands in the repo.
 *
 * If you would rather not dig out the password, open the SQL file and paste
 * it into the Supabase SQL editor instead; the result is identical.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, 'server', 'node_modules', 'pg'));

const REF = (process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co')
  .replace(/^https?:\/\//, '')
  .split('.')[0];

const PASSWORD = process.env.DB_PASSWORD;
const file = process.argv[2];

if (!PASSWORD || !file) {
  console.error('Usage: DB_PASSWORD=... node apply_sql.js <file.sql>');
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(1);
}

const SQL = fs.readFileSync(file, 'utf8');

// Supabase poolers are regional and the project's region is not recorded
// anywhere in the repo, so try the common ones rather than making the caller
// guess. Direct db.<ref>.supabase.co is tried last: it is IPv6-only on newer
// projects and often unreachable from a home connection.
const HOSTS = [
  process.env.DB_HOST,
  'aws-0-eu-west-1.pooler.supabase.com',
  'aws-0-eu-west-2.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-west-1.pooler.supabase.com',
  `db.${REF}.supabase.co`
].filter(Boolean);

(async () => {
  let lastError = null;

  for (const host of HOSTS) {
    const isPooler = host.includes('pooler');
    const client = new Client({
      host,
      port: 5432,
      user: isPooler ? `postgres.${REF}` : 'postgres',
      password: PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000
    });

    try {
      process.stdout.write(`Trying ${host} ... `);
      await client.connect();
      console.log('connected.');
      console.log(`Running ${path.basename(file)} ...`);
      await client.query(SQL);
      console.log('Done.');
      await client.end();
      return;
    } catch (err) {
      console.log(`failed (${err.message})`);
      lastError = err;
      try { await client.end(); } catch { /* already closed */ }

      // A wrong password will fail identically on every host, so stop rather
      // than hammering all of them.
      if (/password authentication failed/i.test(err.message)) break;
    }
  }

  console.error('\nCould not apply the migration.');
  console.error(`Last error: ${lastError && lastError.message}`);
  console.error('\nPaste migrations/add-photos-and-read-receipts.sql into the');
  console.error('Supabase SQL editor instead - it does exactly the same thing.');
  process.exit(2);
})();
