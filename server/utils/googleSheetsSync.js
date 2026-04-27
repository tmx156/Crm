const path = require('path');
const { google } = require('googleapis');
const config = require('../config');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MAX_BOOKINGS_PER_SLOT = 6;
const DATA_COLS_PER_BOOKING = 3; // Name, Phone, Notes
const TOTAL_COLS = 1 + MAX_BOOKINGS_PER_SLOT * DATA_COLS_PER_BOOKING; // 19

function generateTimeSlots() {
  const slots = [];
  const startHour = 10, startMin = 0;
  const endHour = 18, endMin = 0;

  let h = startHour, m = startMin;
  while (h < endHour || (h === endHour && m <= endMin)) {
    slots.push({ hour: h, minute: m });
    m += 15;
    if (m >= 60) { m = 0; h++; }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();
const ROWS_PER_DAY = 2 + TIME_SLOTS.length + 1; // day header + sub-header + slots + separator

function formatTime12h(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:${String(minute).padStart(2, '0')} ${period}`;
}

function hexToSheetsRgb(hex) {
  const h = hex.replace('#', '');
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255
  };
}

function getStatusHex(status, hasSale) {
  if (hasSale && status?.toLowerCase() === 'attended') return '#3b82f6';
  if (hasSale) return '#2563eb';
  switch (status?.toLowerCase()) {
    case 'new': return '#ea580c';
    case 'unconfirmed': return '#f97316';
    case 'confirmed': return '#10b981';
    case 'unassigned': return '#6b7280';
    case 'booked': return '#1e40af';
    case 'arrived': return '#e06666';
    case 'left': return '#000000';
    case 'on show': return '#d97706';
    case 'no sale': return '#dc2626';
    case 'attended': return '#3b82f6';
    case 'complete': return '#3b82f6';
    case 'cancelled': return '#f43f5e';
    case 'no show': return '#f59e0b';
    case 'assigned': return '#7c3aed';
    case 'contacted': return '#0891b2';
    case 'interested': return '#059669';
    case 'not interested': return '#dc2626';
    case 'callback': return '#7c3aed';
    case 'rescheduled': case 'reschedule': return '#ea580c';
    default: return '#6b7280';
  }
}

function getTimeSlotIndex(dateStr) {
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  const slotMin = Math.floor(m / 15) * 15;

  for (let i = 0; i < TIME_SLOTS.length; i++) {
    if (TIME_SLOTS[i].hour === h && TIME_SLOTS[i].minute === slotMin) return i;
  }
  if (h < TIME_SLOTS[0].hour) return 0;
  return TIME_SLOTS.length - 1;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getRowForDay(day) {
  return 2 + (day - 1) * ROWS_PER_DAY;
}

function getSlotRow(day, slotIndex) {
  return getRowForDay(day) + 2 + slotIndex;
}

function colLetter(index) {
  let s = '';
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

class GoogleSheetsSync {
  constructor(io) {
    this.io = io;
    this.sheets = null;
    this.spreadsheetId = null;
    this.isInitialized = false;
    this.updateQueue = [];
    this.flushTimer = null;
    this.sheetIdCache = {};
    this.lastFullSync = null;
  }

  async initialize() {
    const sheetId = config.googleSheets?.spreadsheetId;
    if (!sheetId) {
      console.log('[GoogleSheets] No GOOGLE_SHEETS_ID configured — sync disabled');
      return;
    }
    this.spreadsheetId = sheetId;

    try {
      await this.authenticate();
      console.log('[GoogleSheets] Authenticated successfully');

      const now = new Date();
      await this.ensureMonthTab(now.getFullYear(), now.getMonth());
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await this.ensureMonthTab(nextMonth.getFullYear(), nextMonth.getMonth());

      await this.fullSync();
      this.setupSocketListeners();
      this.isInitialized = true;
      console.log('[GoogleSheets] Sync initialized and running');
    } catch (err) {
      console.error('[GoogleSheets] Initialization failed:', err.message);
    }
  }

  async authenticate() {
    const keyPath = config.googleSheets?.serviceAccountKeyPath;
    const keyJson = config.googleSheets?.serviceAccountKey;

    if (keyPath || keyJson) {
      const authOptions = {
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      };
      if (keyPath) {
        authOptions.keyFile = path.resolve(PROJECT_ROOT, keyPath);
      } else {
        authOptions.credentials = JSON.parse(keyJson);
      }
      const auth = new google.auth.GoogleAuth(authOptions);
      this.sheets = google.sheets({ version: 'v4', auth });
      return;
    }

    // Fallback: try existing OAuth tokens from gmail_accounts
    const { getAuthedClient } = require('./gmailClient');
    const email = config.gmail.email || config.email.gmailUser;
    if (!email) throw new Error('No Google auth configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GMAIL_EMAIL.');
    const oauth2 = await getAuthedClient(email);
    this.sheets = google.sheets({ version: 'v4', auth: oauth2 });
  }

  tabName(year, month) {
    return `${MONTH_NAMES[month]} ${year}`;
  }

  async getSheetId(tabName) {
    if (this.sheetIdCache[tabName] !== undefined) return this.sheetIdCache[tabName];
    const resp = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties'
    });
    for (const s of resp.data.sheets) {
      this.sheetIdCache[s.properties.title] = s.properties.sheetId;
    }
    return this.sheetIdCache[tabName] ?? null;
  }

  async ensureMonthTab(year, month) {
    const name = this.tabName(year, month);
    const existing = await this.getSheetId(name);
    if (existing !== null) return existing;

    const numDays = daysInMonth(year, month);
    const totalRows = 2 + numDays * ROWS_PER_DAY;

    const addResp = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: name,
              gridProperties: { rowCount: totalRows + 10, columnCount: TOTAL_COLS }
            }
          }
        }]
      }
    });

    const newSheetId = addResp.data.replies[0].addSheet.properties.sheetId;
    this.sheetIdCache[name] = newSheetId;

    await this.buildMonthStructure(year, month, newSheetId);
    console.log(`[GoogleSheets] Created tab: ${name}`);
    return newSheetId;
  }

  async buildMonthStructure(year, month, sheetId) {
    const name = this.tabName(year, month);
    const numDays = daysInMonth(year, month);

    // Build all row values
    const allRows = [];

    // Row 0: Month title
    allRows.push([`${MONTH_NAMES[month]} ${year}`]);
    // Row 1: blank
    allRows.push([]);

    for (let day = 1; day <= numDays; day++) {
      const dateObj = new Date(year, month, day);
      const dayName = DAY_NAMES[dateObj.getDay()];

      // Day header
      allRows.push([`${day} ${MONTH_NAMES[month]} - ${dayName}`]);

      // Sub-header
      const subHeader = ['Time'];
      for (let b = 0; b < MAX_BOOKINGS_PER_SLOT; b++) {
        subHeader.push('Name', 'Phone', 'Notes');
      }
      allRows.push(subHeader);

      // Time slot rows
      for (const slot of TIME_SLOTS) {
        const row = [formatTime12h(slot.hour, slot.minute)];
        allRows.push(row);
      }

      // Blank separator
      allRows.push([]);
    }

    // Write all values in one batch
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `'${name}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: allRows }
    });

    // Apply formatting
    const formatRequests = [];

    // Month title: bold, large, merged
    formatRequests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS },
        mergeType: 'MERGE_ALL'
      }
    });
    formatRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 16 },
            horizontalAlignment: 'CENTER',
            backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
            textFormat: { bold: true, fontSize: 16, foregroundColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)'
      }
    });

    // Column A width (Time)
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 100 },
        fields: 'pixelSize'
      }
    });

    // Name columns width
    for (let b = 0; b < MAX_BOOKINGS_PER_SLOT; b++) {
      const nameCol = 1 + b * DATA_COLS_PER_BOOKING;
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: nameCol, endIndex: nameCol + 1 },
          properties: { pixelSize: 150 },
          fields: 'pixelSize'
        }
      });
      // Phone
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: nameCol + 1, endIndex: nameCol + 2 },
          properties: { pixelSize: 130 },
          fields: 'pixelSize'
        }
      });
      // Notes
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: nameCol + 2, endIndex: nameCol + 3 },
          properties: { pixelSize: 200 },
          fields: 'pixelSize'
        }
      });
    }

    // Format each day
    for (let day = 1; day <= numDays; day++) {
      const dayRow = getRowForDay(day);

      // Day header: merge, bold, colored background
      formatRequests.push({
        mergeCells: {
          range: { sheetId, startRowIndex: dayRow, endRowIndex: dayRow + 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS },
          mergeType: 'MERGE_ALL'
        }
      });
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: dayRow, endRowIndex: dayRow + 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, fontSize: 12 },
              backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
              horizontalAlignment: 'LEFT'
            }
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
        }
      });

      // Sub-header row: bold, light background
      const subHeaderRow = dayRow + 1;
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: subHeaderRow, endRowIndex: subHeaderRow + 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, fontSize: 9 },
              backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
              horizontalAlignment: 'CENTER'
            }
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
        }
      });

      // Time column: light styling
      const firstSlotRow = dayRow + 2;
      const lastSlotRow = firstSlotRow + TIME_SLOTS.length;
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstSlotRow, endRowIndex: lastSlotRow, startColumnIndex: 0, endColumnIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: false, fontSize: 9 },
              horizontalAlignment: 'RIGHT',
              backgroundColor: { red: 0.97, green: 0.97, blue: 0.97 }
            }
          },
          fields: 'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)'
        }
      });

      // Add thin borders around the day block
      formatRequests.push({
        updateBorders: {
          range: { sheetId, startRowIndex: dayRow, endRowIndex: lastSlotRow, startColumnIndex: 0, endColumnIndex: TOTAL_COLS },
          top: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
          left: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
          right: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
          innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } },
          innerVertical: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } }
        }
      });
    }

    // Protect the sheet (read-only for non-service-account users)
    formatRequests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId },
          description: 'CRM auto-sync — read only',
          warningOnly: true
        }
      }
    });

    // Send formatting in batches of 100 to avoid exceeding request size limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < formatRequests.length; i += BATCH_SIZE) {
      const batch = formatRequests.slice(i, i + BATCH_SIZE);
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: batch }
      });
    }
  }

  async fullSync() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    console.log(`[GoogleSheets] Starting full sync for ${MONTH_NAMES[month]} ${year}...`);
    await this.syncMonth(year, month);

    const next = new Date(year, month + 1, 1);
    await this.syncMonth(next.getFullYear(), next.getMonth());

    this.lastFullSync = new Date();
    console.log(`[GoogleSheets] Full sync complete`);
  }

  async syncMonth(year, month) {
    const sheetId = await this.ensureMonthTab(year, month);
    const tabName = this.tabName(year, month);
    const numDays = daysInMonth(year, month);

    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 1).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, phone, notes, status, date_booked, has_sale, booking_status, is_confirmed')
      .gte('date_booked', startDate)
      .lt('date_booked', endDate)
      .not('status', 'in', '("Cancelled","Rejected")')
      .order('date_booked', { ascending: true });

    if (error) {
      console.error(`[GoogleSheets] Error fetching leads for ${tabName}:`, error.message);
      return;
    }

    // Group leads by day and time slot
    const grid = {}; // { "day-slotIndex": [lead, lead, ...] }
    for (const lead of (leads || [])) {
      if (!lead.date_booked) continue;
      const d = new Date(lead.date_booked);
      const day = d.getDate();
      const slotIdx = getTimeSlotIndex(lead.date_booked);
      const key = `${day}-${slotIdx}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(lead);
    }

    // Build value rows for the entire month — clear all data columns first
    const clearRange = `'${tabName}'!B1:${colLetter(TOTAL_COLS - 1)}${2 + numDays * ROWS_PER_DAY}`;

    // Clear data columns (keep time column and headers)
    const clearValues = [];
    const totalRows = 2 + numDays * ROWS_PER_DAY;
    for (let r = 0; r < totalRows; r++) {
      clearValues.push(new Array(TOTAL_COLS - 1).fill(''));
    }
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: clearRange,
      valueInputOption: 'RAW',
      requestBody: { values: clearValues }
    });

    // Re-write sub-headers for each day (they got cleared)
    const subHeaderUpdates = [];
    for (let day = 1; day <= numDays; day++) {
      const row = getRowForDay(day) + 1; // sub-header row (0-indexed in our structure, 1-indexed in Sheets)
      const subHeader = [];
      for (let b = 0; b < MAX_BOOKINGS_PER_SLOT; b++) {
        subHeader.push('Name', 'Phone', 'Notes');
      }
      subHeaderUpdates.push({
        range: `'${tabName}'!B${row + 1}:${colLetter(TOTAL_COLS - 1)}${row + 1}`,
        values: [subHeader]
      });
    }
    if (subHeaderUpdates.length > 0) {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: subHeaderUpdates
        }
      });
    }

    // Write booking data and collect formatting requests
    const dataUpdates = [];
    const formatRequests = [];

    for (const [key, bookings] of Object.entries(grid)) {
      const [dayStr, slotStr] = key.split('-');
      const day = parseInt(dayStr);
      const slotIdx = parseInt(slotStr);
      const row = getSlotRow(day, slotIdx); // 0-indexed
      const sheetsRow = row + 1; // 1-indexed for A1 notation

      const rowData = [];
      for (let b = 0; b < Math.min(bookings.length, MAX_BOOKINGS_PER_SLOT); b++) {
        const lead = bookings[b];
        rowData.push(lead.name || '', lead.phone || '', lead.notes || '');

        // Color formatting for this booking's 3 cells
        const hex = getStatusHex(lead.status, lead.has_sale);
        const rgb = hexToSheetsRgb(hex);
        const startCol = 1 + b * DATA_COLS_PER_BOOKING;

        // Determine text color: white for dark backgrounds, dark for light backgrounds
        const luminance = rgb.red * 0.299 + rgb.green * 0.587 + rgb.blue * 0.114;
        const textColor = luminance < 0.5
          ? { red: 1, green: 1, blue: 1 }
          : { red: 0.1, green: 0.1, blue: 0.1 };

        formatRequests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: row,
              endRowIndex: row + 1,
              startColumnIndex: startCol,
              endColumnIndex: startCol + DATA_COLS_PER_BOOKING
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: rgb,
                textFormat: { foregroundColor: textColor, fontSize: 10 }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });
      }

      if (rowData.length > 0) {
        const endColIdx = rowData.length; // data starts at col B (index 1), so last col = 1 + length - 1 = length
        dataUpdates.push({
          range: `'${tabName}'!B${sheetsRow}:${colLetter(endColIdx)}${sheetsRow}`,
          values: [rowData]
        });
      }
    }

    // Batch write data
    if (dataUpdates.length > 0) {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: dataUpdates
        }
      });
    }

    // Batch apply formatting
    const BATCH_SIZE = 100;
    for (let i = 0; i < formatRequests.length; i += BATCH_SIZE) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: formatRequests.slice(i, i + BATCH_SIZE) }
      });
    }

    console.log(`[GoogleSheets] Synced ${tabName}: ${leads?.length || 0} bookings`);
  }

  async syncSingleLead(lead) {
    if (!this.isInitialized || !lead?.date_booked) return;

    try {
      const d = new Date(lead.date_booked);
      const year = d.getFullYear();
      const month = d.getMonth();
      const day = d.getDate();
      const slotIdx = getTimeSlotIndex(lead.date_booked);

      const sheetId = await this.ensureMonthTab(year, month);
      const tabName = this.tabName(year, month);

      // Fetch all bookings for this same time slot (there may be multiple)
      const slotStart = new Date(year, month, day, TIME_SLOTS[slotIdx].hour, TIME_SLOTS[slotIdx].minute);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);

      const { data: bookings } = await supabase
        .from('leads')
        .select('id, name, phone, notes, status, date_booked, has_sale')
        .gte('date_booked', slotStart.toISOString())
        .lt('date_booked', slotEnd.toISOString())
        .not('status', 'in', '("Cancelled","Rejected")')
        .order('date_booked', { ascending: true });

      const row = getSlotRow(day, slotIdx);
      const sheetsRow = row + 1;

      // Clear the data columns for this row
      const clearCols = new Array(TOTAL_COLS - 1).fill('');
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${tabName}'!B${sheetsRow}:${colLetter(TOTAL_COLS - 1)}${sheetsRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [clearCols] }
      });

      // Clear formatting for the data columns
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: TOTAL_COLS },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 1, green: 1, blue: 1 },
                  textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, fontSize: 10 }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          }]
        }
      });

      if (!bookings || bookings.length === 0) return;

      // Write booking data
      const rowData = [];
      const formatRequests = [];

      for (let b = 0; b < Math.min(bookings.length, MAX_BOOKINGS_PER_SLOT); b++) {
        const bk = bookings[b];
        rowData.push(bk.name || '', bk.phone || '', bk.notes || '');

        const hex = getStatusHex(bk.status, bk.has_sale);
        const rgb = hexToSheetsRgb(hex);
        const startCol = 1 + b * DATA_COLS_PER_BOOKING;
        const luminance = rgb.red * 0.299 + rgb.green * 0.587 + rgb.blue * 0.114;
        const textColor = luminance < 0.5
          ? { red: 1, green: 1, blue: 1 }
          : { red: 0.1, green: 0.1, blue: 0.1 };

        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: startCol, endColumnIndex: startCol + DATA_COLS_PER_BOOKING },
            cell: {
              userEnteredFormat: {
                backgroundColor: rgb,
                textFormat: { foregroundColor: textColor, fontSize: 10 }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${tabName}'!B${sheetsRow}:${colLetter(rowData.length)}${sheetsRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowData] }
      });

      if (formatRequests.length > 0) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: formatRequests }
        });
      }
    } catch (err) {
      console.error('[GoogleSheets] Error syncing lead:', err.message);
    }
  }

  queueUpdate(lead) {
    if (!this.isInitialized) return;
    this.updateQueue.push(lead);

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushQueue(), 2000);
  }

  async flushQueue() {
    const leads = [...this.updateQueue];
    this.updateQueue = [];
    if (leads.length === 0) return;

    // Deduplicate by lead ID — keep latest
    const unique = new Map();
    for (const lead of leads) {
      unique.set(lead.id, lead);
    }

    for (const lead of unique.values()) {
      await this.syncSingleLead(lead);
    }
  }

  async handleLeadEvent(data) {
    if (!this.isInitialized) return;

    const lead = data?.lead || data;
    if (!lead?.id) return;

    // If the event includes full lead data with date_booked, sync it directly
    if (lead.date_booked) {
      this.queueUpdate(lead);
      return;
    }

    // Otherwise fetch the lead from DB to check if it has a booking
    try {
      const { data: fullLead } = await supabase
        .from('leads')
        .select('id, name, phone, notes, status, date_booked, has_sale')
        .eq('id', lead.id || lead.leadId)
        .single();

      if (fullLead?.date_booked) {
        this.queueUpdate(fullLead);
      }
    } catch (err) {
      console.error('[GoogleSheets] Error fetching lead for sync:', err.message);
    }
  }

  async handleLeadDelete(data) {
    if (!this.isInitialized) return;
    // On delete, do a full re-sync of affected month since we don't know the old date_booked
    // This is rare enough that a full month sync is acceptable
    const now = new Date();
    await this.syncMonth(now.getFullYear(), now.getMonth());
  }

  setupSocketListeners() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      socket.on('lead_update', (data) => this.handleLeadEvent(data));
      socket.on('booking_update', (data) => this.handleLeadEvent(data));
    });

    // Also listen to server-side emits via a global event pattern
    const originalEmit = this.io.emit.bind(this.io);
    this.io.emit = (...args) => {
      const [event, data] = args;

      if (event === 'lead_updated' || event === 'lead_created') {
        this.handleLeadEvent(data);
      } else if (event === 'lead_deleted') {
        this.handleLeadDelete(data);
      } else if (event === 'calendar_sync_needed' || event === 'diary_updated') {
        this.handleLeadEvent(data?.data || data);
      }

      return originalEmit(...args);
    };

    console.log('[GoogleSheets] Socket listeners attached for real-time sync');
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      spreadsheetId: this.spreadsheetId,
      lastFullSync: this.lastFullSync,
      queueLength: this.updateQueue.length
    };
  }
}

let instance = null;

function startGoogleSheetsSync(io) {
  if (instance) return instance;
  instance = new GoogleSheetsSync(io);
  instance.initialize().catch(err => {
    console.error('[GoogleSheets] Failed to start sync:', err.message);
  });
  return instance;
}

function getGoogleSheetsSync() {
  return instance;
}

module.exports = { startGoogleSheetsSync, getGoogleSheetsSync };
