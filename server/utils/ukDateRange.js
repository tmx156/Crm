// Turns a Period name ('today', 'this_week', ...) into a UTC start/end pair
// whose edges fall on UK midnight (Europe/London, so BST/GMT is handled).
// Weeks run Monday-Sunday. `end` is exclusive: use created_at < end.

const TZ = 'Europe/London';

// UK calendar date (year, month 0-11, day) for an instant.
function ukParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
  return { y: get('year'), m: get('month') - 1, d: get('day') };
}

// Minutes the UK is ahead of UTC at an instant (0 in GMT, 60 in BST).
function ukOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date);
  const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// The UTC instant of 00:00 UK time on y/m/d (month/day may overflow; Date.UTC normalises).
function ukMidnight(y, m, d) {
  const guess = new Date(Date.UTC(y, m, d));
  return new Date(guess.getTime() - ukOffsetMinutes(guess) * 60000);
}

function getUkDateRange(dateRange, now = new Date()) {
  const { y, m, d } = ukParts(now);
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun
  const sinceMonday = (dow + 6) % 7;

  switch (dateRange) {
    case 'today':
      return { start: ukMidnight(y, m, d), end: ukMidnight(y, m, d + 1) };
    case 'yesterday':
      return { start: ukMidnight(y, m, d - 1), end: ukMidnight(y, m, d) };
    case 'this_week':
      return { start: ukMidnight(y, m, d - sinceMonday), end: ukMidnight(y, m, d - sinceMonday + 7) };
    case 'last_week':
      return { start: ukMidnight(y, m, d - sinceMonday - 7), end: ukMidnight(y, m, d - sinceMonday) };
    case 'this_month':
      return { start: ukMidnight(y, m, 1), end: ukMidnight(y, m + 1, 1) };
    case 'last_month':
      return { start: ukMidnight(y, m - 1, 1), end: ukMidnight(y, m, 1) };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return { start: ukMidnight(y, q, 1), end: ukMidnight(y, q + 3, 1) };
    }
    case 'this_year':
      return { start: ukMidnight(y, 0, 1), end: ukMidnight(y + 1, 0, 1) };
    default:
      return null; // 'all' or unknown: no date filter
  }
}

module.exports = { getUkDateRange };
