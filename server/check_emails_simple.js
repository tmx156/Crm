const axios = require('axios');

(async () => {
  try {
    const response = await axios.get('http://localhost:3001/api/leads/public?limit=500');
    const leads = response.data || [];

    const withEmails = leads.filter(l => l.email && l.email.trim());

    console.log('📋 Leads with email addresses:\n');
    console.log('='.repeat(90));
    console.log('Lead Name'.padEnd(30) + ' | ' + 'Email'.padEnd(35) + ' | Status');
    console.log('='.repeat(90));

    withEmails.slice(0, 100).forEach(lead => {
      const name = (lead.name || 'N/A').substring(0, 28).padEnd(30);
      const email = (lead.email || 'N/A').substring(0, 33).padEnd(35);
      console.log(`${name} | ${email} | ${lead.status || 'N/A'}`);
    });

    console.log('='.repeat(90));
    console.log(`\nTotal leads with emails: ${withEmails.length}`);
    console.log(`Total leads: ${leads.length}`);
    console.log(`\nLead emails that might match inbox:`);

    const emailAddresses = withEmails.map(l => l.email.toLowerCase().trim());
    const uniqueEmails = [...new Set(emailAddresses)];
    console.log(`Unique email addresses: ${uniqueEmails.length}\n`);

    // Show some examples
    console.log('Sample emails in CRM:');
    uniqueEmails.slice(0, 20).forEach(email => console.log(`  - ${email}`));

  } catch (error) {
    console.error('Error:', error.message);
  }
})();
