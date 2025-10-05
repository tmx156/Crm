/**
 * Date Correction Utility
 * Fixes the system date being set to 2025 instead of 2024
 *
 * ISSUE: System clock shows 2025, but it should be 2024
 * This utility provides corrected dates for notifications
 */

/**
 * Get corrected current date (fixes year 2025 -> 2024)
 * @returns {Date} Date object with corrected year
 */
function getCorrectedDate() {
    const systemDate = new Date();
    const year = systemDate.getFullYear();

    // If system shows 2025, correct it to 2024
    if (year === 2025) {
        const correctedDate = new Date(systemDate);
        correctedDate.setFullYear(2024);
        return correctedDate;
    }

    return systemDate;
}

/**
 * Get corrected current date as ISO string
 * @returns {string} ISO string with corrected year
 */
function getCorrectedISOString() {
    return getCorrectedDate().toISOString();
}

/**
 * Correct a date object if it has year 2025
 * @param {Date|string} date - Date object or ISO string to correct
 * @returns {Date} Corrected date object
 */
function correctDate(date) {
    if (!date) return getCorrectedDate();

    const dateObj = date instanceof Date ? date : new Date(date);

    if (isNaN(dateObj.getTime())) {
        return getCorrectedDate();
    }

    // If year is 2025, correct it to 2024
    if (dateObj.getFullYear() === 2025) {
        const correctedDate = new Date(dateObj);
        correctedDate.setFullYear(2024);
        return correctedDate;
    }

    return dateObj;
}

/**
 * Correct a date and return as ISO string
 * @param {Date|string} date - Date object or ISO string to correct
 * @returns {string} Corrected ISO string
 */
function correctDateToISO(date) {
    return correctDate(date).toISOString();
}

/**
 * Check if a date has the year 2025 issue
 * @param {Date|string} date - Date to check
 * @returns {boolean} True if date has year 2025
 */
function hasYear2025Issue(date) {
    if (!date) return false;
    const dateObj = date instanceof Date ? date : new Date(date);
    return dateObj.getFullYear() === 2025;
}

module.exports = {
    getCorrectedDate,
    getCorrectedISOString,
    correctDate,
    correctDateToISO,
    hasYear2025Issue
};