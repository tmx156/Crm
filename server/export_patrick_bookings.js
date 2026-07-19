const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function exportBookings() {
  const patrickId = 'cc36d7a4-0960-4ec2-bd0a-ed3b015ec453';
  const todayStart = '2026-04-23T00:00:00.000Z';
  const todayEnd = '2026-04-23T23:59:59.999Z';

  const { data: leads, error } = await supabase
    .from('leads')
    .select('name, phone, age, notes, date_booked, booked_at')
    .eq('booker_id', patrickId)
    .gte('booked_at', todayStart)
    .lte('booked_at', todayEnd)
    .order('booked_at', { ascending: true });

  if (error) { console.error('Query error:', error); return; }

  const rows = leads.map((l, i) => {
    const appt = l.date_booked ? new Date(l.date_booked) : null;
    return {
      '#': i + 1,
      'Name': l.name || '',
      'Phone': l.phone || '',
      'Age': l.age || '',
      'Notes': l.notes || '',
      'Appointment Date': appt ? appt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
      'Appointment Time': appt ? appt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
    };
  });

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);

  // Set column widths
  ws['!cols'] = [
    { wch: 4 },   // #
    { wch: 30 },  // Name
    { wch: 16 },  // Phone
    { wch: 6 },   // Age
    { wch: 50 },  // Notes
    { wch: 16 },  // Date
    { wch: 12 }   // Time
  ];

  xlsx.utils.book_append_sheet(wb, ws, 'Patrick Bookings 23 Apr');
  const outPath = require('path').join(__dirname, '..', 'Patrick_Bookings_23_April.xlsx');
  xlsx.writeFile(wb, outPath);
  console.log(`Exported ${rows.length} bookings to ${outPath}`);
}

exportBookings().catch(console.error);
