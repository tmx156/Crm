const axios = require('axios');

async function testAPI() {
  try {
    const response = await axios.get('http://localhost:5000/api/stats/leads-public');
    console.log('Public Stats API Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAPI();



