/**
 * Restore a CRM_Backup_*.xlsx export into the database.
 *
 *   node server/restore_backup.js <file.xlsx> --dry-run   # report only, no writes
 *   node server/restore_backup.js <file.xlsx>             # apply
 *
 * Everything runs in ONE transaction: any failure rolls the whole restore back.
 *
 * Notes on the export format:
 *  - empty cells arrive as '' and must become NULL for uuid/timestamp/numeric columns
 *  - booleans may arrive as 0/1
 *  - jsonb columns arrive as JSON text
 *  - secrets (password_hash, oauth tokens) are exported as the literal '[REDACTED]'
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const XLSX = require('xlsx');
const { Client } = require('pg');

const FILE = process.argv[2] || 'C:/Users/Tinashe/Desktop/CRM_Backup_2026-08-24.xlsx';
const DRY = process.argv.includes('--dry-run');

// Parent tables first — foreign keys depend on this order.
const ORDER = ['users', 'leads', 'templates', 'messages', 'booking_history', 'sales', 'gmail_accounts'];

// Columns present in the backup but absent from the schema, which hold real data.
const ADD_COLUMNS = [
  ['messages', 'read_at', 'timestamptz'],
  ['templates', 'variables', 'jsonb'],
  ['booking_history', 'timestamp', 'timestamptz']
];

const REDACTED = '[REDACTED]';

function coerce(value, type) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  switch (type) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      return ['true', 't', '1', 'yes'].includes(String(value).toLowerCase());
    case 'integer': case 'bigint': case 'smallint': {
      const n = parseInt(value, 10); return Number.isNaN(n) ? null : n;
    }
    case 'numeric': case 'double precision': case 'real': {
      const n = parseFloat(value); return Number.isNaN(n) ? null : n;
    }
    case 'jsonb': case 'json':
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value); // already JSON text
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const { rows: colRows } = await client.query(
    `select table_name, column_name, data_type from information_schema.columns where table_schema='public'`
  );
  const schema = {};
  for (const r of colRows) (schema[r.table_name] ||= {})[r.column_name] = r.data_type;

  const wb = XLSX.readFile(FILE);
  console.log(`📄 ${FILE}`);
  console.log(`${DRY ? '🔍 DRY RUN — no writes' : '✍️  APPLYING'}\n`);

  // Restore is additive: existing rows are left alone and conflicting backup rows
  // are skipped (ON CONFLICT DO NOTHING). This matters because a locally-created
  // admin may be the only account with a usable password — the backup's hashes
  // are redacted — so wiping users would lock everyone out.
  const preexisting = {};
  for (const t of ORDER) {
    const { rows } = await client.query(`select count(*)::int n from "${t}"`);
    preexisting[t] = rows[0].n;
    if (rows[0].n > 0) console.log(`ℹ️  ${t} already has ${rows[0].n} row(s) — they will be kept`);
  }
  if (Object.values(preexisting).some(n => n > 0)) console.log('');

  if (!DRY) await client.query('begin');

  try {
    for (const [table, col, type] of ADD_COLUMNS) {
      if (schema[table] && !schema[table][col]) {
        const sql = `alter table "${table}" add column if not exists "${col}" ${type}`;
        if (!DRY) await client.query(sql);
        schema[table][col] = type === 'timestamptz' ? 'timestamp with time zone' : type;
        console.log(`   + added ${table}.${col} ${type}`);
      }
    }
    if (ADD_COLUMNS.length) console.log('');

    const report = [];

    for (const table of ORDER) {
      if (!wb.SheetNames.includes(table)) { console.log(`— ${table}: not in backup, skipped`); continue; }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[table], { defval: null });
      if (!rows.length) { console.log(`— ${table}: 0 rows`); continue; }

      const cols = Object.keys(rows[0]).filter(c => schema[table] && schema[table][c]);
      const dropped = Object.keys(rows[0]).filter(c => !cols.includes(c));
      let redactedCount = 0;
      let inserted = 0;

      for (const row of rows) {
        const values = cols.map(c => {
          if (row[c] === REDACTED) redactedCount++;
          return coerce(row[c], schema[table][c]);
        });
        if (!DRY) {
          const ph = values.map((_, i) => `$${i + 1}`).join(', ');
          const names = cols.map(c => `"${c}"`).join(', ');
          const res = await client.query(
            `insert into "${table}" (${names}) values (${ph}) on conflict do nothing`, values
          );
          inserted += res.rowCount;
        }
      }

      const skipped = DRY ? 0 : rows.length - inserted;
      report.push({ table, rows: rows.length, cols: cols.length, dropped, redactedCount });
      console.log(`✔ ${table}: ${DRY ? rows.length + ' rows to insert' : inserted + ' inserted'}` +
        (skipped ? `, ${skipped} skipped (conflict)` : '') +
        `, ${cols.length} columns` +
        (dropped.length ? ` (dropped empty: ${dropped.join(', ')})` : '') +
        (redactedCount ? ` ⚠️ ${redactedCount} redacted value(s)` : ''));
    }

    if (!DRY) { await client.query('commit'); console.log('\n✅ Committed.'); }
    else console.log('\n🔍 Dry run complete — nothing written.');

    if (!DRY) {
      console.log('\n📊 Final row counts:');
      for (const t of ORDER) {
        const { rows } = await client.query(`select count(*)::int n from "${t}"`);
        console.log(`   ${t}: ${rows[0].n}`);
      }
    }
  } catch (err) {
    if (!DRY) await client.query('rollback').catch(() => {});
    console.error('\n❌ Failed, rolled back — database unchanged.');
    console.error(`   ${err.message}`);
    if (err.detail) console.error(`   ${err.detail}`);
    await client.end();
    process.exit(1);
  }

  await client.end();
})();
