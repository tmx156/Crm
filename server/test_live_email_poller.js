#!/usr/bin/env node

/**
 * Test Live Email Poller
 * Runs the email poller independently to test real-time email processing
 */

const { startEmailPoller } = require('./utils/emailPoller');
const { EventEmitter } = require('events');

class MockSocketIO extends EventEmitter {
    to(room) {
        return {
            emit: (event, data) => {
                console.log(`📡 Socket emit to ${room}: ${event}`, data.messageId ? `Message ${data.messageId}` : '');
            }
        };
    }
}

console.log('🧪 LIVE EMAIL POLLER TEST');
console.log('=========================');
console.log('This will run the email poller independently to test live email processing.');
console.log('The poller will connect to IMAP and process any new emails in real-time.');
console.log('');

// Create mock Socket.IO instance
const mockIO = new MockSocketIO();

console.log('📧 Starting email poller...');
console.log('This will:');
console.log('1. Connect to Gmail IMAP');
console.log('2. Process any unprocessed messages');
console.log('3. Enter IDLE mode to wait for new emails');
console.log('4. Process new emails as they arrive');
console.log('');
console.log('💡 Send an email to avensismodels.co.uk.crm.bookings@gmail.com to test live processing');
console.log('⏹️  Press Ctrl+C to stop');
console.log('');

// Start the email poller
startEmailPoller(mockIO);

// Keep the script running
process.on('SIGINT', () => {
    console.log('\n📧 Stopping email poller...');
    process.exit(0);
});

// Prevent script from exiting
setInterval(() => {
    // Keep alive
}, 30000);