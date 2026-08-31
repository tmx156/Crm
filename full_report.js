const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const maleNames = ['ian','olatunbosun','odopa','peter','scott','thomas','paul','keith','steve','bohdan','jonathan','christopher','jamie','dave','michael','stephen','robert','george','glyn','mark','john','david','james','andrew','gary','kevin','richard','brian','derek','colin','roger','graham','trevor','roy','frank','danny','bob','ted','rob','mike','chris','dan','tim','jim','joe','andy','pete','mick','nick','phil','tony','rick','ron','ken','don','ray','stan','des','doug','reg','len','vic','bert','alf','sid','fred','ed','bobby','eddie','tommy','sammy','jimmy','johnny','billy','terry','jerry','matthew','anthony','nathan','dean','ryan','liam','ben','jack','oliver','charlie','harry','william','lewis','luke','tom','alex','jake','toby','callum','ross','sean','aaron','dominic','bradley','gareth','gavin','marcus','alan','barry','stuart','neil','norman','martin','patrick','philip','simon','timothy','wayne','glenn','carl','craig','darren','lee','jason','adam','daniel','lloyd','heath','syed','murray','neill','ramneesh','zane','mikhail','mr','jordan','sandy','joshua','vincent','nigel','martyn','jon','vikramsing','s.','steven'];
const femaleNames = ['tracey','liga','hannah','louise','helena','chantel','colette','lisa','clare','samantha','mandy','rebekah','tina','julie','veronica','maria','aisha','lindsey','claudiana','sharon','melanie','jayne','joanne','sian','barbara','nalini','sarah','adeola','natalie','jane','jodie','anna','susan','helen','margaret','elizabeth','patricia','christine','linda','carol','janet','sandra','jean','mary','ann','dorothy','diana','florentina','donna','emma','fiona','gail','heather','holly','jackie','jenny','karen','kate','kerry','kim','laura','lesley','liz','lucy','lynn','marie','rachel','rebecca','rosemary','sally','sheila','stella','sue','teresa','tracy','yvonne','andrea','dawn','elaine','deborah','denise','gillian','hilary','jacqueline','julia','leanne','lorraine','lynne','michelle','nicola','stephanie','suzanne','victoria','charlotte','claire','emily','georgia','imogen','jessica','katherine','lauren','megan','olivia','sophie','zoe','amelia','amber','bethany','chloe','courtney','danielle','eleanor','gemma','grace','hayley','jade','katie','kirsty','leah','maisie','millie','molly','naomi','paige','phoebe','poppy','rosie','ruby','scarlett','sienna','tegan','yasmin','antoinette','yolanda','mrs','ada','rachael','hazel','carita','aneta','tanya','caroline','bernadette','amy','maryam','bridget','hyacinth','kelly','paula','sridevi','wanda','caren','jenna','katarzyna','dominga','felicity','reihaneh','dee','linsey','jody','nikki','eva','toni','tashana','ramanpreet','lysa','ana','linnette','abimbola','choni','lianne','nazia','riyah','louisa','pearl','shylet','angela','ranjot','anne','olha','maureen','wendy','sara','iyela','nicky','kerrie-anne','brenda','donnamarie','catherine','marjorie','sasha','ozlem','dana','federica','kathryn','shinta','colette','charlotte','claire','donna','lyndsay','joanna','alicia','tootsie','tanya','helen','kay','gerri','jennie','dawn','skye','charmaine'];

function getGender(name) {
  const first = name.split(' ')[0].trim().toLowerCase();
  if (maleNames.includes(first)) return 'Male';
  if (femaleNames.includes(first)) return 'Female';
  return 'Unknown';
}

function isShowedUp(lead) {
  return ['Attended','Arrived','Left','No Sale'].includes(lead.status) ||
         ['Attended','Arrived','Left','No Sale'].includes(lead.booking_status);
}

// BST = UTC+1. May 11 00:00 BST = May 10 23:00 UTC. May 22 00:00 BST = May 21 23:00 UTC.
const BST_START = '2026-05-10T23:00:00+00:00';
const BST_END   = '2026-05-21T23:00:00+00:00';

async function run() {
  const { data: users } = await supabase.from('users').select('id, name');
  const um = {};
  for (const u of users) um[u.id] = u.name;

  // First let's check what timezone date_booked is stored in
  console.log('=== TIMEZONE CHECK ===');
  const { data: sample } = await supabase.from('leads').select('name, date_booked, booked_at, created_at').gte('date_booked', '2026-05-13T00:00:00').lt('date_booked', '2026-05-13T01:00:00').limit(5);
  if (sample && sample.length > 0) {
    console.log('Sample leads with early morning date_booked:');
    sample.forEach(l => console.log('  ' + l.name + ' | date_booked: ' + l.date_booked + ' | booked_at: ' + l.booked_at + ' | created_at: ' + l.created_at));
  } else {
    console.log('No early morning bookings found (appointments likely start at 10am)');
  }

  // Check a booked_at around midnight to see timezone
  const { data: midnightSample } = await supabase.from('leads').select('name, date_booked, booked_at, created_at').gte('booked_at', '2026-05-10T22:00:00').lt('booked_at', '2026-05-11T01:00:00').limit(10);
  console.log('\nLeads booked around midnight May 10-11 (UTC):');
  if (midnightSample) midnightSample.forEach(l => console.log('  ' + l.name + ' | booked_at: ' + l.booked_at + ' | date_booked: ' + l.date_booked));

  // 1. Calendar leads - date_booked appears to be local time (appointment time), so no BST adjustment needed
  const { data: calLeads } = await supabase
    .from('leads')
    .select('id, name, age, status, date_booked, booking_status, booker_id, booked_at')
    .gte('date_booked', '2026-05-11T00:00:00')
    .lt('date_booked', '2026-05-22T00:00:00')
    .order('date_booked', { ascending: true });

  // 2. Bookings made during May 11-21 BST (booked_at is UTC, so adjust for BST)
  const { data: madeLeads } = await supabase
    .from('leads')
    .select('id, name, age, status, date_booked, booking_status, booker_id, booked_at')
    .gte('booked_at', BST_START)
    .lt('booked_at', BST_END)
    .order('booked_at', { ascending: true });

  // Also get the NON-BST version to compare
  const { data: madeLeadsUTC } = await supabase
    .from('leads')
    .select('id, name')
    .gte('booked_at', '2026-05-11T00:00:00')
    .lt('booked_at', '2026-05-22T00:00:00');

  console.log('\n=== COMPARISON ===');
  console.log('Calendar appointments (date_booked) May 11-21:', calLeads.length);
  console.log('Bookings made (booked_at) UTC midnight-midnight:', madeLeadsUTC.length);
  console.log('Bookings made (booked_at) BST midnight-midnight:', madeLeads.length);

  // Check edge cases - leads in BST but not UTC
  const bstIds = new Set(madeLeads.map(l => l.id));
  const utcIds = new Set(madeLeadsUTC.map(l => l.id));
  const inBSTnotUTC = madeLeads.filter(l => !utcIds.has(l.id));
  const inUTCnotBST = madeLeadsUTC.filter(l => !bstIds.has(l.id));
  console.log('In BST range but not UTC range:', inBSTnotUTC.length);
  if (inBSTnotUTC.length > 0) {
    inBSTnotUTC.forEach(l => console.log('  + ' + l.name + ' | booked_at: ' + l.booked_at));
  }
  console.log('In UTC range but not BST range:', inUTCnotBST.length);
  if (inUTCnotBST.length > 0) {
    inUTCnotBST.forEach(l => console.log('  - ' + l.name + ' | booked_at: (check DB)'));
  }

  // 3. Sales
  const allIds = [...new Set([...calLeads.map(l=>l.id), ...madeLeads.map(l=>l.id)])];
  const chunks = [];
  for (let i = 0; i < allIds.length; i += 200) chunks.push(allIds.slice(i, i + 200));
  let sales = [];
  for (const chunk of chunks) {
    const { data } = await supabase.from('sales').select('lead_id, amount').in('lead_id', chunk);
    if (data) sales = sales.concat(data);
  }
  const saleMap = {};
  for (const sl of sales) saleMap[sl.lead_id] = sl.amount;

  // 4. Leads created during period (BST adjusted)
  const { data: createdLeads } = await supabase
    .from('leads')
    .select('id, status, date_booked, created_at')
    .gte('created_at', BST_START)
    .lt('created_at', BST_END);

  const { data: createdLeadsUTC } = await supabase
    .from('leads')
    .select('id')
    .gte('created_at', '2026-05-11T00:00:00')
    .lt('created_at', '2026-05-22T00:00:00');

  console.log('Leads created UTC:', createdLeadsUTC.length);
  console.log('Leads created BST:', createdLeads.length);

  // === CALENDAR STATS ===
  console.log('\n=============================================');
  console.log('  FULL REPORT: May 11-21, 2026 (BST)');
  console.log('=============================================');

  console.log('\n=== ON THE CALENDAR (appointments May 11-21) ===');
  console.log('Total appointments:', calLeads.length);

  const calDays = {};
  for (const l of calLeads) {
    const d = l.date_booked.split('T')[0];
    if (!calDays[d]) calDays[d] = { total: 0, cancelled: 0, noShow: 0, showedUp: 0, pending: 0, sales: 0, revenue: 0 };
    calDays[d].total++;
    if (l.status === 'Cancelled') calDays[d].cancelled++;
    else if (l.booking_status === 'No Show') calDays[d].noShow++;
    else if (isShowedUp(l)) calDays[d].showedUp++;
    else calDays[d].pending++;
    if (saleMap[l.id]) { calDays[d].sales++; calDays[d].revenue += saleMap[l.id]; }
  }

  console.log('\nDay | Total | Cancelled | No Show | Showed Up | Pending | Sales | Revenue');
  let totals = { t: 0, c: 0, ns: 0, su: 0, p: 0, s: 0, r: 0 };
  for (const [d, s] of Object.entries(calDays).sort()) {
    console.log(d + ' | ' + s.total + ' | ' + s.cancelled + ' | ' + s.noShow + ' | ' + s.showedUp + ' | ' + s.pending + ' | ' + s.sales + ' | ' + s.revenue);
    totals.t += s.total; totals.c += s.cancelled; totals.ns += s.noShow; totals.su += s.showedUp; totals.p += s.pending; totals.s += s.sales; totals.r += s.revenue;
  }
  console.log('TOTAL | ' + totals.t + ' | ' + totals.c + ' | ' + totals.ns + ' | ' + totals.su + ' | ' + totals.p + ' | ' + totals.s + ' | ' + totals.r);

  // Gender
  let males = 0, females = 0, unk = 0;
  let maleAges = [], femaleAges = [], allAges = [];
  let maleShowed = 0, femaleShowed = 0;
  let maleSales = 0, femaleSales = 0, maleSaleCount = 0, femaleSaleCount = 0;
  let maleCancelled = 0, femaleCancelled = 0, maleNoShow = 0, femaleNoShow = 0;

  for (const l of calLeads) {
    const g = getGender(l.name);
    if (g === 'Male') {
      males++;
      if (l.age) maleAges.push(l.age);
      if (isShowedUp(l)) maleShowed++;
      if (l.status === 'Cancelled') maleCancelled++;
      if (l.booking_status === 'No Show') maleNoShow++;
      if (saleMap[l.id]) { maleSales += saleMap[l.id]; maleSaleCount++; }
    } else if (g === 'Female') {
      females++;
      if (l.age) femaleAges.push(l.age);
      if (isShowedUp(l)) femaleShowed++;
      if (l.status === 'Cancelled') femaleCancelled++;
      if (l.booking_status === 'No Show') femaleNoShow++;
      if (saleMap[l.id]) { femaleSales += saleMap[l.id]; femaleSaleCount++; }
    } else { unk++; }
    if (l.age) allAges.push(l.age);
  }

  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A';

  console.log('\n=== GENDER ===');
  console.log('Male: ' + males + ' (' + (males / calLeads.length * 100).toFixed(1) + '%)');
  console.log('Female: ' + females + ' (' + (females / calLeads.length * 100).toFixed(1) + '%)');
  console.log('Unknown: ' + unk);

  console.log('\n=== AGE ===');
  console.log('Overall Avg: ' + avg(allAges));
  console.log('Male Avg: ' + avg(maleAges));
  console.log('Female Avg: ' + avg(femaleAges));
  console.log('Youngest: ' + Math.min(...allAges));
  console.log('Oldest: ' + Math.max(...allAges));

  console.log('\n=== SHOW-UP & SPEND BY GENDER ===');
  console.log('Male: ' + maleShowed + ' showed / ' + males + ' total (' + (males > 0 ? (maleShowed / males * 100).toFixed(1) : 0) + '%) | Cancelled: ' + maleCancelled + ' | No Show: ' + maleNoShow);
  console.log('Female: ' + femaleShowed + ' showed / ' + females + ' total (' + (females > 0 ? (femaleShowed / females * 100).toFixed(1) : 0) + '%) | Cancelled: ' + femaleCancelled + ' | No Show: ' + femaleNoShow);
  console.log('Male Sales: ' + maleSaleCount + ' | Revenue: ' + maleSales + ' | Per Capita (per show-up): ' + (maleShowed > 0 ? (maleSales / maleShowed).toFixed(2) : 0));
  console.log('Female Sales: ' + femaleSaleCount + ' | Revenue: ' + femaleSales + ' | Per Capita (per show-up): ' + (femaleShowed > 0 ? (femaleSales / femaleShowed).toFixed(2) : 0));

  // Buyers
  console.log('\n=== BUYERS ===');
  for (const l of calLeads) {
    if (saleMap[l.id]) {
      console.log(l.name + ' | Age: ' + (l.age || '-') + ' | ' + getGender(l.name) + ' | ' + saleMap[l.id] + ' | ' + l.date_booked.split('T')[0]);
    }
  }
  const buyerAges = calLeads.filter(l => saleMap[l.id] && l.age).map(l => l.age);
  console.log('Avg Buyer Age: ' + avg(buyerAges));

  // === BOOKINGS MADE (BST) ===
  console.log('\n=== BOOKINGS MADE during May 11-21 BST (by booker) ===');
  const byUser = {};
  for (const l of madeLeads) {
    const uid = l.booker_id || 'none';
    const name = um[l.booker_id] || 'Unknown';
    if (!byUser[uid]) byUser[uid] = { name, total: 0, thisRange: 0, future: 0, cancelled: 0, noShow: 0, showedUp: 0, pending: 0, sales: 0, revenue: 0 };
    byUser[uid].total++;
    const d = l.date_booked;
    if (d >= '2026-05-11' && d < '2026-05-22') byUser[uid].thisRange++;
    else byUser[uid].future++;
    if (l.status === 'Cancelled') byUser[uid].cancelled++;
    else if (l.booking_status === 'No Show') byUser[uid].noShow++;
    else if (isShowedUp(l)) byUser[uid].showedUp++;
    else byUser[uid].pending++;
    if (saleMap[l.id]) { byUser[uid].sales++; byUser[uid].revenue += saleMap[l.id]; }
  }

  console.log('Booker | Booked | Appt This Range | Appt Future | Cancelled | Cancel% | No Show | Showed Up | Show% | Pending | Sales | Revenue');
  let grandTotal = { t: 0, tr: 0, f: 0, c: 0, ns: 0, su: 0, p: 0, s: 0, r: 0 };
  for (const [uid, s] of Object.entries(byUser).sort((a, b) => b[1].total - a[1].total)) {
    const nonCancel = s.total - s.cancelled;
    const showRate = nonCancel > 0 ? (s.showedUp / nonCancel * 100).toFixed(1) : '0';
    const cancelRate = s.total > 0 ? (s.cancelled / s.total * 100).toFixed(1) : '0';
    console.log(s.name + ' | ' + s.total + ' | ' + s.thisRange + ' | ' + s.future + ' | ' + s.cancelled + ' | ' + cancelRate + '% | ' + s.noShow + ' | ' + s.showedUp + ' | ' + showRate + '% | ' + s.pending + ' | ' + s.sales + ' | ' + s.revenue);
    grandTotal.t += s.total; grandTotal.tr += s.thisRange; grandTotal.f += s.future; grandTotal.c += s.cancelled; grandTotal.ns += s.noShow; grandTotal.su += s.showedUp; grandTotal.p += s.pending; grandTotal.s += s.sales; grandTotal.r += s.revenue;
  }
  console.log('TOTAL | ' + grandTotal.t + ' | ' + grandTotal.tr + ' | ' + grandTotal.f + ' | ' + grandTotal.c + ' | ' + (grandTotal.c / grandTotal.t * 100).toFixed(1) + '% | ' + grandTotal.ns + ' | ' + grandTotal.su + ' | ' + ((grandTotal.su / (grandTotal.t - grandTotal.c)) * 100).toFixed(1) + '% | ' + grandTotal.p + ' | ' + grandTotal.s + ' | ' + grandTotal.r);

  // === LEAD CREATION FUNNEL (BST) ===
  console.log('\n=== LEADS CREATED during May 11-21 BST ===');
  console.log('Total created:', createdLeads.length);
  const statusCounts = {};
  for (const l of createdLeads) statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  for (const [st, ct] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + st + ': ' + ct + ' (' + (ct / createdLeads.length * 100).toFixed(1) + '%)');
  }
  const neverBooked = createdLeads.filter(l => !l.date_booked).length;
  const gotBooked = createdLeads.filter(l => l.date_booked).length;
  console.log('Got a booking: ' + gotBooked + ' (' + (gotBooked / createdLeads.length * 100).toFixed(1) + '%)');
  console.log('Never booked: ' + neverBooked + ' (' + (neverBooked / createdLeads.length * 100).toFixed(1) + '%)');
}

run();
