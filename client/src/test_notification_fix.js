/**
 * Test Notification Time Fix
 * Tests the timezone correction for notification timestamps
 */

// Simulate the fixed timestamp logic
function formatTimeFixed(timestamp) {
    let formattedTime = 'Just now';
    if (timestamp) {
        try {
            // Handle timestamps without Z suffix by treating them as UTC
            let timestampToUse = timestamp;
            if (typeof timestampToUse === 'string' &&
                timestampToUse.includes('T') &&
                !timestampToUse.endsWith('Z') &&
                !timestampToUse.includes('+') &&
                !timestampToUse.includes('-', 10)) { // Don't add Z if timezone offset already present
                timestampToUse = timestampToUse + 'Z';
            }

            const date = new Date(timestampToUse);
            if (!isNaN(date.getTime())) {
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffMins < 1) {
                    formattedTime = 'Just now';
                } else if (diffMins < 60) {
                    formattedTime = `${diffMins} min ago`;
                } else if (diffHours < 24) {
                    formattedTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                } else if (diffDays < 7) {
                    formattedTime = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                } else {
                    formattedTime = date.toLocaleDateString();
                }
            }
        } catch (e) {
            console.warn('Invalid timestamp:', timestamp);
        }
    }
    return formattedTime;
}

// Simulate the old (broken) timestamp logic
function formatTimeOld(timestamp) {
    let formattedTime = 'Just now';
    if (timestamp) {
        try {
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffMins < 1) {
                    formattedTime = 'Just now';
                } else if (diffMins < 60) {
                    formattedTime = `${diffMins} min ago`;
                } else if (diffHours < 24) {
                    formattedTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                } else if (diffDays < 7) {
                    formattedTime = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                } else {
                    formattedTime = date.toLocaleDateString();
                }
            }
        } catch (e) {
            console.warn('Invalid timestamp:', timestamp);
        }
    }
    return formattedTime;
}

console.log('🧪 NOTIFICATION TIME FIX TEST');
console.log('============================');

// Test cases
const testTimestamps = [
    {
        timestamp: '2025-09-25T19:51:41',
        description: 'Recent message without Z (problematic)'
    },
    {
        timestamp: '2025-09-25T19:51:41.000Z',
        description: 'Recent message with Z (correct)'
    },
    {
        timestamp: new Date(Date.now() - 300000).toISOString(),
        description: '5 minutes ago (ISO with Z)'
    },
    {
        timestamp: new Date(Date.now() - 300000).toISOString().replace('Z', ''),
        description: '5 minutes ago (no Z - fixed by our code)'
    }
];

testTimestamps.forEach((test, i) => {
    console.log(`\nTest ${i + 1}: ${test.description}`);
    console.log(`Timestamp: ${test.timestamp}`);

    const oldResult = formatTimeOld(test.timestamp);
    const fixedResult = formatTimeFixed(test.timestamp);

    console.log(`Old logic shows: "${oldResult}"`);
    console.log(`Fixed logic shows: "${fixedResult}"`);

    if (oldResult !== fixedResult) {
        console.log(`✅ FIX APPLIED: "${oldResult}" → "${fixedResult}"`);
    } else {
        console.log(`ℹ️  No change needed`);
    }
});

console.log('\n🎯 SUMMARY:');
console.log('The fix adds "Z" to timestamps without timezone info,');
console.log('treating them as UTC instead of local time.');
console.log('This prevents the 1-hour offset issue in notifications.');

export { formatTimeFixed };