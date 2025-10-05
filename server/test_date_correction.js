#!/usr/bin/env node

/**
 * Test Date Correction Utility
 * Verifies that the date correction fixes work properly
 */

const { getCorrectedDate, getCorrectedISOString, correctDate, correctDateToISO, hasYear2025Issue } = require('./utils/dateCorrection');

console.log('🧪 DATE CORRECTION TEST');
console.log('======================');

// Test 1: System date shows 2025
console.log('\n1. System Date Test:');
const systemDate = new Date();
console.log(`   System date: ${systemDate.toISOString()}`);
console.log(`   System year: ${systemDate.getFullYear()}`);

// Test 2: Corrected date should be 2024
console.log('\n2. Date Correction Test:');
const correctedDate = getCorrectedDate();
const correctedISO = getCorrectedISOString();
console.log(`   Corrected date: ${correctedDate.toISOString()}`);
console.log(`   Corrected year: ${correctedDate.getFullYear()}`);
console.log(`   getCorrectedISOString(): ${correctedISO}`);

// Test 3: Test date correction function
console.log('\n3. Correction Function Test:');
const testDate2025 = new Date('2025-09-25T14:30:00Z');
const testDate2024 = new Date('2024-09-25T14:30:00Z');

console.log(`   Input 2025 date: ${testDate2025.toISOString()}`);
console.log(`   Corrected: ${correctDateToISO(testDate2025)}`);
console.log(`   Has 2025 issue: ${hasYear2025Issue(testDate2025)}`);

console.log(`   Input 2024 date: ${testDate2024.toISOString()}`);
console.log(`   Corrected: ${correctDateToISO(testDate2024)}`);
console.log(`   Has 2025 issue: ${hasYear2025Issue(testDate2024)}`);

// Test 4: Test with invalid dates
console.log('\n4. Invalid Date Test:');
const invalidDate = new Date('invalid');
const correctedInvalid = correctDateToISO(invalidDate);
console.log(`   Invalid date corrected to: ${correctedInvalid}`);
console.log(`   Should be 2024: ${correctedInvalid.includes('2024')}`);

// Test 5: Test with null/undefined
console.log('\n5. Null/Undefined Test:');
const nullCorrected = correctDateToISO(null);
const undefinedCorrected = correctDateToISO(undefined);
console.log(`   Null corrected to: ${nullCorrected}`);
console.log(`   Undefined corrected to: ${undefinedCorrected}`);
console.log(`   Both should be 2024: ${nullCorrected.includes('2024') && undefinedCorrected.includes('2024')}`);

// Test 6: Simulate email poller date handling
console.log('\n6. Email Poller Simulation:');
const mockInternalDate = new Date('2025-09-25T12:30:00Z');
const emailReceivedDate = correctDateToISO(mockInternalDate);
const processingDate = getCorrectedISOString();

console.log(`   Mock email internal date (2025): ${mockInternalDate.toISOString()}`);
console.log(`   Corrected received date: ${emailReceivedDate}`);
console.log(`   Processing date: ${processingDate}`);
console.log(`   Both are 2024: ${emailReceivedDate.includes('2024') && processingDate.includes('2024')}`);

// Test 7: Simulate SMS timestamp handling
console.log('\n7. SMS Timestamp Simulation:');
const mockSMSTimestamp = '2025-09-25T15:45:00.123Z';
const smsDate = new Date(mockSMSTimestamp);
const correctedSMSDate = correctDateToISO(smsDate);

console.log(`   Mock SMS timestamp (2025): ${mockSMSTimestamp}`);
console.log(`   Corrected SMS date: ${correctedSMSDate}`);
console.log(`   Is 2024: ${correctedSMSDate.includes('2024')}`);

console.log('\n📊 TEST RESULTS:');
console.log('================');

const allTests = [
    correctedDate.getFullYear() === 2024,
    correctedISO.includes('2024'),
    correctDateToISO(testDate2025).includes('2024'),
    !correctDateToISO(testDate2024).includes('2025'), // Should NOT contain 2025
    correctedInvalid.includes('2024'),
    nullCorrected.includes('2024'),
    undefinedCorrected.includes('2024'),
    emailReceivedDate.includes('2024'),
    processingDate.includes('2024'),
    correctedSMSDate.includes('2024')
];

const passedTests = allTests.filter(t => t).length;
const totalTests = allTests.length;

console.log(`✅ Passed: ${passedTests}/${totalTests} tests`);

if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED! Date correction is working correctly.');
    console.log('📧 Email notifications will now show correct dates (2024)');
    console.log('📱 SMS notifications will now show correct dates (2024)');
} else {
    console.log('❌ Some tests failed. Date correction needs adjustment.');
}

console.log('\n💡 Next steps:');
console.log('1. Restart your CRM server to apply the date fixes');
console.log('2. New emails and SMS will have correct dates');
console.log('3. Old messages will keep their incorrect dates (no retroactive fix)');