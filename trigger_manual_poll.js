/**
 * Manually trigger email poll to import waiting emails
 */

require('dotenv').config();

// Load emailPoller
const { EmailPoller } = require('./server/utils/emailPoller');
const socketIo = require('socket.io');
const http = require('http');

async function manualPoll() {
  console.log('\n' + '='.repeat(80));
  console.log('📧 MANUALLY TRIGGERING EMAIL POLL');
  console.log('='.repeat(80) + '\n');

  // Create minimal socket.io instance for poller
  const server = http.createServer();
  const io = socketIo(server);

  console.log('📧 Initializing email poller...\n');

  const poller = new EmailPoller(io, 'primary');

  if (poller.disabled) {
    console.error('❌ Email poller is disabled!');
    process.exit(1);
  }

  console.log('📧 Connecting to Gmail API...\n');

  const connected = await poller.connect();

  if (!connected) {
    console.error('❌ Failed to connect to Gmail API');
    process.exit(1);
  }

  console.log('✅ Connected to Gmail API\n');
  console.log('📧 Scanning for new messages...\n');

  // Manually trigger a scan
  await poller.scanMessages();

  console.log('\n✅ Manual poll complete!\n');
  console.log('📊 Check your CRM - new emails should now appear!\n');

  // Stop polling and exit
  poller.stopPolling();
  server.close();
  process.exit(0);
}

manualPoll().catch(error => {
  console.error('\n❌ Manual poll failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
