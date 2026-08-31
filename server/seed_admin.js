/**
 * Seed the first admin user into a fresh database.
 *
 * A new project starts with an empty `users` table, and the mounted auth route
 * (routes/auth-simple.js) only exposes /login and /me — there is no register
 * endpoint — so the first account has to be inserted directly.
 *
 * Run it yourself so the password is never passed through anything but bcrypt:
 *   node server/seed_admin.js
 *
 * It prompts for name, email and password, hashes the password with the same
 * cost factor auth-simple.js uses (10), and inserts the row.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

// Read without echoing to the terminal, so the password is not left on screen.
function askHidden(rl, question) {
  return new Promise(resolve => {
    const onData = char => {
      if (['\n', '\r', ''].includes(char.toString())) {
        process.stdin.removeListener('data', onData);
      } else {
        readline.moveCursor(process.stdout, -1, 0);
        readline.clearLine(process.stdout, 1);
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, answer => {
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  console.log(`🗄️  Target project: ${SUPABASE_URL}`);

  // Refuse to run against a database that already has users — this is a
  // bootstrap script, not a way to add teammates.
  const { data: existing, error: countError } = await supabase
    .from('users')
    .select('id, email')
    .limit(5);

  if (countError) {
    console.error('❌ Could not read the users table:', countError.message);
    console.error('   Has 00_full_schema.sql been applied to this project yet?');
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.error(`❌ The users table already has ${existing.length} row(s) — refusing to seed.`);
    console.error('   Existing: ' + existing.map(u => u.email).join(', '));
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const name = (await ask(rl, 'Admin name: ')) || 'Admin';
  const email = (await ask(rl, 'Admin email: ')).toLowerCase();
  const password = await askHidden(rl, 'Admin password: ');
  const confirm = await askHidden(rl, 'Confirm password: ');
  rl.close();

  if (!email || !email.includes('@')) {
    console.error('❌ A valid email is required.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    process.exit(1);
  }
  if (password !== confirm) {
    console.error('❌ Passwords do not match.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert({
      name,
      email,
      password_hash: passwordHash,
      role: 'admin',
      is_active: true
    })
    .select('id, name, email, role')
    .single();

  if (error) {
    console.error('❌ Insert failed:', error.message);
    process.exit(1);
  }

  console.log(`✅ Admin created: ${data.name} <${data.email}> (role: ${data.role})`);
  console.log('   Sign in at http://localhost:3000/login');
})();
