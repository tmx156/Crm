const path = require('path');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const fbCapi = require('./facebookConversions');

// Pulls new applications from the landing site's "Model Applications" sheet into
// the CRM.
//
// The landing site is meant to push every lead to /api/webhook/leads, but that
// push has failed silently for weeks at a time (missing env vars on Vercel), and
// the only symptom was leads turning up a day late via a manual CSV upload. The
// sheet itself is reliable — the site awaits and retries the append — so the CRM
// now reads it directly. The webhook still works and still wins when it fires;
// this only fills in the rows it missed.

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const SHEET_ID = process.env.LEAD_SHEET_ID || '11QuB1V2KpKGF5Fj8UNQbLxwMNHmikjM-1Hm3PuBLtvY';
const SHEET_TAB = process.env.LEAD_SHEET_TAB || 'Sheet1';
const POLL_INTERVAL_MS = parseInt(process.env.LEAD_SHEET_POLL_MS) || 15000;
// Only the tail of the sheet is read; ~50 applications a day, so this is days of slack.
const TAIL_ROWS = 400;
// Rows older than this are never imported, so a first run doesn't revive old applicants.
const MAX_AGE_DAYS = 3;
// Rows younger than this are left for the webhook, so the two don't race.
const WEBHOOK_GRACE_MS = 30 * 1000;

// Sheet columns: created, Name, Age, Email, phone, postcode, Image_url, parent phone, source, note
const COL = { created: 0, name: 1, age: 2, email: 3, phone: 4, postcode: 5, image: 6, parentPhone: 7, source: 8, note: 9 };

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

// Current UK wall-clock time as "YYYY-MM-DD HH:MM:SS", the same clock the sheet's
// "created" column is written in.
function londonNow(offsetMs = 0) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(Date.now() + offsetMs));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// "21/10/2026, 03:42:20" -> "2026-10-21 03:42:20"
function sheetTimestamp(value) {
  const m = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4])}:${m[5]}:${m[6]}`;
}

// "2026-10-21 03:42:20" UK wall-clock time -> UTC ISO string (handles BST/GMT).
function ukTimeToUtc(ts) {
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const shown = new Date(londonNow(asUtc - Date.now()).replace(' ', 'T') + 'Z').getTime();
  return new Date(asUtc - (shown - asUtc)).toISOString();
}

// The forms the same UK mobile is stored under across the CRM's import paths.
function phoneVariants(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  const variants = new Set([raw, digits]);
  let national = digits;
  if (digits.startsWith('44')) national = '0' + digits.slice(2);
  // The form lets people drop the leading 0 ("7960160239").
  else if (digits.length === 10 && digits.startsWith('7')) national = '0' + digits;
  if (national.startsWith('0') && national.length === 11) {
    variants.add(national);
    variants.add(`${national.slice(0, 5)} ${national.slice(5)}`);
    variants.add(`+44${national.slice(1)}`);
    variants.add(`44${national.slice(1)}`);
  }
  return [...variants].filter(v => v.length >= 7);
}

class LeadSheetImporter {
  constructor(io) {
    this.io = io;
    this.sheets = null;
    this.timer = null;
    this.running = false;
    this.lastRun = null;
    this.lastImported = 0;
    this.totalImported = 0;
    this.lastError = null;
  }

  async authenticate() {
    let keyPath = config.googleSheets?.serviceAccountKeyPath;
    let keyJson = config.googleSheets?.serviceAccountKey;
    if (keyPath && keyPath.trim().startsWith('{')) {
      keyJson = keyPath;
      keyPath = null;
    }
    if (!keyPath && !keyJson) throw new Error('No Google service account configured (GOOGLE_SERVICE_ACCOUNT_KEY_PATH / GOOGLE_SERVICE_ACCOUNT_KEY)');

    const authOptions = { scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] };
    if (keyPath) authOptions.keyFile = path.resolve(PROJECT_ROOT, keyPath);
    else authOptions.credentials = JSON.parse(keyJson);
    this.sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth(authOptions) });
  }

  async start() {
    await this.authenticate();
    console.log(`[LeadSheetImport] Watching sheet ${SHEET_ID} every ${Math.round(POLL_INTERVAL_MS / 1000)}s`);
    await this.runOnce();
    this.timer = setInterval(() => this.runOnce(), POLL_INTERVAL_MS);
  }

  async readTail() {
    const colA = await this.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_TAB}'!A:A`
    });
    const lastRow = (colA.data.values || []).length;
    if (lastRow < 2) return [];
    const firstRow = Math.max(2, lastRow - TAIL_ROWS + 1);
    const resp = await this.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_TAB}'!A${firstRow}:J${lastRow}`
    });
    return resp.data.values || [];
  }

  // Deleted leads count as existing, so a lead someone removed doesn't come back.
  async leadExists(row) {
    const email = String(row[COL.email] || '').trim();
    if (email) {
      const { data, error } = await supabase
        .from('leads')
        .select('id')
        .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
        .limit(1);
      if (error) throw error;
      if (data.length) return true;
    }
    const variants = phoneVariants(row[COL.phone]);
    if (variants.length) {
      const { data, error } = await supabase
        .from('leads')
        .select('id')
        .in('phone', variants)
        .limit(1);
      if (error) throw error;
      if (data.length) return true;
    }
    return false;
  }

  async insertLead(row) {
    const source = String(row[COL.source] || '').trim();
    const ageNum = parseInt(row[COL.age]);
    const now = new Date().toISOString();
    // Same shape as the webhook in routes/webhook.js, so reports treat both alike.
    const leadToInsert = {
      id: uuidv4(),
      name: String(row[COL.name] || '').trim(),
      phone: String(row[COL.phone] || '').trim(),
      email: String(row[COL.email] || '').trim(),
      postcode: String(row[COL.postcode] || '').trim(),
      age: Number.isFinite(ageNum) ? ageNum : null,
      parent_phone: String(row[COL.parentPhone] || '').trim(),
      image_url: String(row[COL.image] || '').trim(),
      status: 'New',
      notes: source ? `Website Lead: ${source}` : 'Website Lead',
      booking_history: JSON.stringify([]),
      is_confirmed: 0,
      booking_status: null,
      date_booked: null,
      booker_id: null,
      created_by_user_id: null,
      booked_at: null,
      ever_booked: false,
      created_at: now,
      updated_at: now
    };

    const { data, error } = await supabase.from('leads').insert([leadToInsert]).select();
    if (error) throw error;
    const lead = data[0];

    if (this.io) {
      this.io.emit('lead_updated', { lead, action: 'created', leadId: lead.id, timestamp: now });
      this.io.emit('stats_update_needed', { type: 'lead_created', leadId: lead.id, timestamp: now });
    }
    fbCapi.trackLead(lead, { actionSource: 'website' }).catch(err => {
      console.error('[FB CAPI] Unhandled error in trackLead (sheet import):', err.message);
    });
    return lead;
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    let imported = 0;
    try {
      const rows = await this.readTail();
      const oldest = londonNow(-MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
      const newest = londonNow(-WEBHOOK_GRACE_MS);

      for (const row of rows) {
        const ts = sheetTimestamp(row[COL.created]);
        if (!ts || ts < oldest || ts > newest) continue;
        if (!String(row[COL.name] || '').trim() || !String(row[COL.phone] || '').trim()) continue;
        // The landing site appends repeat applicants with this note; they're already in the CRM.
        if (/REPEAT APPLICANT/i.test(String(row[COL.note] || ''))) continue;
        if (await this.leadExists(row)) continue;

        const lead = await this.insertLead(row);
        imported++;
        console.log(`✅ [LeadSheetImport] Created lead "${lead.name}" (${lead.id}) from sheet row dated ${ts}`);
      }
      this.lastError = null;
    } catch (err) {
      this.lastError = err.message || String(err);
      console.error('❌ [LeadSheetImport] Run failed:', this.lastError);
    } finally {
      this.lastRun = new Date();
      this.lastImported = imported;
      this.totalImported += imported;
      this.running = false;
    }
  }

  getStatus() {
    return {
      sheetId: SHEET_ID,
      intervalMs: POLL_INTERVAL_MS,
      lastRun: this.lastRun,
      lastImported: this.lastImported,
      totalImported: this.totalImported,
      lastError: this.lastError
    };
  }
}

let instance = null;

function startLeadSheetImporter(io) {
  if (instance) return instance;
  instance = new LeadSheetImporter(io);
  instance.start().catch(err => {
    console.error('❌ [LeadSheetImport] Failed to start:', err.message);
  });
  return instance;
}

function getLeadSheetImporter() {
  return instance;
}

module.exports = { startLeadSheetImporter, getLeadSheetImporter, LeadSheetImporter, phoneVariants, sheetTimestamp, ukTimeToUtc };
