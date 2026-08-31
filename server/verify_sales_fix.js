// Quick verification that our sales attribution fixes are in place
const fs = require('fs');

console.log('🔍 VERIFYING SALES ATTRIBUTION FIXES');
console.log('=====================================');

// Check if sales-supabase.js has the user_id fix
const salesSupabasePath = './routes/sales-supabase.js';
if (fs.existsSync(salesSupabasePath)) {
  const content = fs.readFileSync(salesSupabasePath, 'utf8');

  // Check for user_id assignment in sales creation
  const hasUserIdAssignment = content.includes('user_id: req.user.id');
  const hasUserNameInResponse = content.includes('user_name: userResult?.[0]?.name');

  console.log('✅ sales-supabase.js exists');
  console.log(`✅ User ID assignment in sales creation: ${hasUserIdAssignment ? 'YES' : 'NO'}`);
  console.log(`✅ User name in API response: ${hasUserNameInResponse ? 'YES' : 'NO'}`);

  if (hasUserIdAssignment && hasUserNameInResponse) {
    console.log('✅ BACKEND FIXES ARE IN PLACE');
  } else {
    console.log('❌ BACKEND FIXES ARE MISSING');
  }
} else {
  console.log('❌ sales-supabase.js not found');
}

// Check if frontend Sales.js has the debug logging
const salesJsPath = '../client/src/pages/Sales.js';
if (fs.existsSync(salesJsPath)) {
  const content = fs.readFileSync(salesJsPath, 'utf8');

  const hasDebugLogging = content.includes('SALES USER ATTRIBUTION DEBUG');
  const hasUserNameDisplay = content.includes('sale.user_name ||');

  console.log('✅ Sales.js exists');
  console.log(`✅ Debug logging added: ${hasDebugLogging ? 'YES' : 'NO'}`);
  console.log(`✅ User name display logic: ${hasUserNameDisplay ? 'YES' : 'NO'}`);

  if (hasUserNameDisplay) {
    console.log('✅ FRONTEND FIXES ARE IN PLACE');
  } else {
    console.log('❌ FRONTEND FIXES ARE MISSING');
  }
} else {
  console.log('❌ Sales.js not found');
}

console.log('\n🎯 DEPLOYMENT STATUS:');
console.log('If both backend and frontend fixes are in place,');
console.log('the issue should be resolved after server restart.');
console.log('If still seeing "created by system", the server may not be running updated code.');
