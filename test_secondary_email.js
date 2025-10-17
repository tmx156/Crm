require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
const { sendEmail, EMAIL_ACCOUNTS } = require('./server/utils/emailService');

console.log('========================================');
console.log('Testing Secondary Email Account');
console.log('========================================\n');

// Display configured accounts
console.log('Configured Email Accounts:');
console.log('Primary:', EMAIL_ACCOUNTS.primary.user || 'NOT SET');
console.log('Secondary:', EMAIL_ACCOUNTS.secondary.user || 'NOT SET');
console.log('');

async function testSecondaryEmail() {
    try {
        // Test email recipient (you can change this to your own email)
        const testRecipient = EMAIL_ACCOUNTS.secondary.user; // Send to itself for testing

        console.log('========================================');
        console.log('Test 1: Sending from PRIMARY account');
        console.log('========================================');

        const result1 = await sendEmail(
            testRecipient,
            'CRM Test - Primary Account',
            `This is a test email sent from the PRIMARY account (${EMAIL_ACCOUNTS.primary.user}).\n\nSent at: ${new Date().toISOString()}`,
            [], // no attachments
            'primary' // explicitly use primary account
        );

        console.log('Primary Account Result:', result1.success ? '✅ SUCCESS' : '❌ FAILED');
        if (!result1.success) {
            console.error('Error:', result1.error);
        } else {
            console.log('Message ID:', result1.messageId);
            console.log('Port used:', result1.port);
        }
        console.log('');

        // Wait a bit between sends
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('========================================');
        console.log('Test 2: Sending from SECONDARY account');
        console.log('========================================');

        const result2 = await sendEmail(
            testRecipient,
            'CRM Test - Secondary Account',
            `This is a test email sent from the SECONDARY account (${EMAIL_ACCOUNTS.secondary.user}).\n\nSent at: ${new Date().toISOString()}`,
            [], // no attachments
            'secondary' // use secondary account
        );

        console.log('Secondary Account Result:', result2.success ? '✅ SUCCESS' : '❌ FAILED');
        if (!result2.success) {
            console.error('Error:', result2.error);
        } else {
            console.log('Message ID:', result2.messageId);
            console.log('Port used:', result2.port);
        }
        console.log('');

        console.log('========================================');
        console.log('Test Summary');
        console.log('========================================');
        console.log('Primary Account (Avensis):', result1.success ? '✅ Working' : '❌ Failed');
        console.log('Secondary Account (Camry):', result2.success ? '✅ Working' : '❌ Failed');
        console.log('');

        if (result1.success && result2.success) {
            console.log('🎉 SUCCESS! Both email accounts are working correctly!');
            console.log('');
            console.log('Next steps:');
            console.log('1. Check the inbox of', testRecipient);
            console.log('2. You should see 2 test emails (one from each account)');
            console.log('3. Verify the "From" address is different for each email');
        } else {
            console.log('⚠️ Some tests failed. Check the errors above.');
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.error(error);
    }

    process.exit(0);
}

// Run the test
console.log('Starting email tests...\n');
testSecondaryEmail();
