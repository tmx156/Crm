/**
 * Booking times are stored in `leads.date_booked` as UK wall-clock time carrying a
 * UTC label — a 2:00pm appointment is stored as `2026-09-20T14:00:00+00:00`, not as
 * the instant 2:00pm BST (which would be 13:00Z). Every row in the table follows
 * this convention, and the confirmation email/SMS templates already read it back
 * with `timeZone: 'UTC'`.
 *
 * The rules that keeps that consistent:
 *   - WRITING  a booking: build the string from wall-clock parts (toBookingDateString).
 *              Never call `.toISOString()` on a local Date — in BST that shifts the
 *              appointment an hour earlier every single time it is saved.
 *   - READING  a booking: pull the wall-clock parts back out (parseBookingDate).
 *              Never let the browser re-interpret the value in its own timezone —
 *              in BST that displays the appointment an hour later than it was booked.
 */

const BOOKING_PARTS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Read a stored booking value into a Date whose LOCAL fields are the booked
 * wall-clock time, so local-timezone rendering (FullCalendar, toLocaleString)
 * shows the time the booker actually picked.
 */
export const parseBookingDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    // Dates carrying a stored booking hold the wall clock in their UTC fields.
    return new Date(
      value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(),
      value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), 0
    );
  }

  const parts = BOOKING_PARTS.exec(String(value));
  if (!parts) return null;

  const [, year, month, day, hours, minutes, seconds] = parts;
  return new Date(
    Number(year), Number(month) - 1, Number(day),
    Number(hours), Number(minutes), Number(seconds || 0), 0
  );
};

/**
 * Serialise a Date whose LOCAL fields are the intended wall-clock time into the
 * stored booking format. This is the only way a booking time should be written.
 */
export const toBookingDateString = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000Z`;
};

/** Build the stored booking format from a `YYYY-MM-DD` date and `HH:mm` time. */
export const bookingDateStringFromParts = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const [hours, minutes] = timeStr.split(':');
  return `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`;
};

/** `HH:mm` for a time input, straight from the stored wall clock. */
export const bookingTimeInputValue = (value) => {
  const d = parseBookingDate(value);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const formatBookingDate = (value, locale = 'en-GB', options) =>
  (parseBookingDate(value) || { toLocaleDateString: () => '' })
    .toLocaleDateString(locale, options);

export const formatBookingTime = (value, locale = 'en-GB', options = { hour: '2-digit', minute: '2-digit' }) =>
  (parseBookingDate(value) || { toLocaleTimeString: () => '' })
    .toLocaleTimeString(locale, options);

export const formatBookingDateTime = (value, locale = 'en-GB') => {
  const d = parseBookingDate(value);
  if (!d) return '';
  return `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
};
