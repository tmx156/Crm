const dbManager = require('./database-connection-manager');
const { v4: uuidv4 } = require('uuid');

/**
 * Import the 12 missing leads from Jax CSV
 */

const missingLeads = [
  {
    name: "Teresa Goodwin",
    age: 55,
    email: "goodt12@gmail.com",
    phone: "7967798533",
    postcode: "Cw39nf",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/20220709_193952.jpg"
  },
  {
    name: "Susan Powell",
    age: 56,
    email: "susan.powell55@outlook.com",
    phone: "7894408825",
    postcode: "YO88DF",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/IMG_4463.jpeg"
  },
  {
    name: "Adriana",
    age: 35,
    email: "diablicekrpell@gmail.com",
    phone: "7780888454",
    postcode: "FY12QH",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/2021-12-14.jpg"
  },
  {
    name: "Adriana Rigoova",
    age: 35,
    email: "slikajustin7@gmail.com",
    phone: "7823896222",
    postcode: "FY12QH",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/2021-12-141.jpg"
  },
  {
    name: "Victoria Herrington",
    age: 54,
    email: "vickyherrington1@gmail.com",
    phone: "7508173660",
    postcode: "NG228BJ",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/IMG_5597.jpeg"
  },
  {
    name: "Andrea Bradley",
    age: 60,
    email: "fisherqueen13@gmail.com",
    phone: "7484880883",
    postcode: "Ng340rr",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/inbound8963507894597567753.jpg"
  },
  {
    name: "Kelly Bentham",
    age: 51,
    email: "kellybentham74@icloud.com",
    phone: "7931780814",
    postcode: "S661WR",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/IMG_6868.jpeg"
  },
  {
    name: "Aelita Dean",
    age: 51,
    email: "katepuculens@yahoo.com",
    phone: "7411968060",
    postcode: "DE757LT",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/IMG_7182.jpeg"
  },
  {
    name: "Tina Feeley AKA Andrew",
    age: 62,
    email: "tinafeeley1963@gmail.com",
    phone: "7369240676",
    postcode: "M262UF",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/30-08-2024-TINA-CORONA-BLANCA-PLAYA-DEL-INGLES-GRAN-CANARIA-3.jpg"
  },
  {
    name: "Jacqueline Naylor",
    age: 57,
    email: "jackienaylor8815@hotmail.com",
    phone: "7885675432",
    postcode: "NG10 3EE",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/inbound4942723383425291264.jpg"
  },
  {
    name: "Karen donovan",
    age: 63,
    email: "donovankaren129@gmail.com",
    phone: "7791805046",
    postcode: "Cw9 8jq",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/inbound8955681792250127794.jpg"
  },
  {
    name: "Urszula",
    age: 39,
    email: "ulaboreckabania@gmail.com",
    phone: "7514024972",
    postcode: "Hd63AH",
    image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/IMG_9411.jpeg"
  }
];

async function importLeads() {
  console.log('🚀 Starting import of 12 missing Jax leads...\n');

  const results = {
    success: [],
    failed: [],
    total: missingLeads.length
  };

  for (const lead of missingLeads) {
    try {
      // Prepare lead data for insertion (matching database schema)
      const leadData = {
        id: uuidv4(),
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        postcode: lead.postcode,
        image_url: lead.image_url,
        parent_phone: null,
        age: lead.age,
        booker_id: null,
        status: 'New',
        date_booked: null,
        is_confirmed: 0,
        booking_status: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Insert into database
      const inserted = await dbManager.insert('leads', leadData);

      if (inserted && inserted.length > 0) {
        console.log(`✅ Added: ${lead.name} (${lead.phone})`);
        results.success.push({
          lead: lead.name,
          id: inserted[0].id,
          phone: lead.phone
        });
      } else {
        console.log(`❌ Failed to add: ${lead.name} (${lead.phone})`);
        results.failed.push({
          lead: lead.name,
          phone: lead.phone,
          reason: 'Insert returned no data'
        });
      }

    } catch (error) {
      console.error(`❌ Error adding ${lead.name}:`, error.message);
      results.failed.push({
        lead: lead.name,
        phone: lead.phone,
        reason: error.message
      });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('📊 IMPORT SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total leads to import: ${results.total}`);
  console.log(`Successfully imported: ${results.success.length}`);
  console.log(`Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\n❌ Failed imports:');
    results.failed.forEach(fail => {
      console.log(`  - ${fail.lead} (${fail.phone}): ${fail.reason}`);
    });
  }

  console.log('\n✅ Import complete!');
  return results;
}

// Run import
if (require.main === module) {
  importLeads()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { importLeads };
