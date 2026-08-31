const https = require('https');

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Try to get database settings via Supabase API
function tryHost(host, port, user) {
  const { Client } = require('pg');
  return new Promise(async (resolve) => {
    const client = new Client({
      host, port,
      database: 'postgres',
      user,
      password: '0ALicn6Y9xnfaoiC',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });
    try {
      await client.connect();
      console.log('CONNECTED: ' + user + '@' + host + ':' + port);
      await client.end();
      resolve(true);
    } catch (err) {
      console.log('FAIL ' + user + '@' + host + ':' + port + ' -> ' + err.message.substring(0, 80));
      resolve(false);
    }
  });
}

async function run() {
  const ref = 'tnltvfzltdeilanxhlvy';
  const hosts = [
    ['db.' + ref + '.supabase.co', 5432, 'postgres'],
    [ref + '.supabase.co', 5432, 'postgres'],
    ['aws-0-eu-west-1.pooler.supabase.com', 6543, 'postgres.' + ref],
    ['aws-0-eu-west-2.pooler.supabase.com', 6543, 'postgres.' + ref],
    ['aws-0-eu-central-1.pooler.supabase.com', 6543, 'postgres.' + ref],
    ['aws-0-us-east-1.pooler.supabase.com', 6543, 'postgres.' + ref],
    ['aws-0-us-west-1.pooler.supabase.com', 6543, 'postgres.' + ref],
    ['aws-0-ap-southeast-1.pooler.supabase.com', 6543, 'postgres.' + ref],
    ['aws-0-eu-west-1.pooler.supabase.com', 5432, 'postgres.' + ref],
    ['aws-0-eu-west-2.pooler.supabase.com', 5432, 'postgres.' + ref],
    ['aws-0-eu-central-1.pooler.supabase.com', 5432, 'postgres.' + ref],
    ['aws-0-us-east-1.pooler.supabase.com', 5432, 'postgres.' + ref],
  ];

  for (const [host, port, user] of hosts) {
    const ok = await tryHost(host, port, user);
    if (ok) break;
  }
}

run();
