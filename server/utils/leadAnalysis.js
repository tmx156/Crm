const axios = require('axios');
const levenshtein = require('fast-levenshtein');
const { createClient } = require('@supabase/supabase-js');

// Normalize phone number to last 10 digits
function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-10);
}

// Normalize email for comparison
function normalizeEmail(email) {
  if (!email) return '';
  return email.toLowerCase().trim();
}

// Fetch legacy leads from Supabase
async function fetchLegacyLeads() {
  try {
    // Initialize Supabase client with hardcoded credentials (same as database manager)
    const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch legacy leads from separate legacy_leads table with pagination
    console.log('📜 Fetching legacy leads with pagination...');

    const allLegacyLeads = [];
    const batchSize = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from('legacy_leads')
        .select('id, name, phone, email, postcode, age, image_url, import_timestamp')
        .eq('import_status', 'imported')
        .range(from, from + batchSize - 1)
        .order('import_timestamp', { ascending: false });

      if (error) {
        console.error('❌ Error fetching legacy leads batch:', error.message);
        break;
      }

      if (!batch || batch.length === 0) {
        hasMore = false;
      } else {
        allLegacyLeads.push(...batch);
        from += batchSize;

        // Safety check to prevent infinite loops
        if (from > 50000) {
          console.log('⚠️ Reached safety limit of 50,000 records');
          break;
        }
      }
    }

    console.log(`📜 Successfully fetched ${allLegacyLeads.length} total legacy leads`);

    if (!allLegacyLeads || allLegacyLeads.length === 0) {
      console.log('⚠️ No legacy leads found in legacy_leads table');
      return [];
    }

    // Log a sample of the legacy leads for debugging
    if (allLegacyLeads.length > 0) {
      console.log('📋 Sample legacy leads:');
      allLegacyLeads.slice(0, 3).forEach((lead, i) => {
        console.log(`  ${i + 1}. ${lead.name || 'N/A'} - ${lead.phone || 'N/A'} - ${lead.email || 'N/A'}`);
      });
    }

    return allLegacyLeads;

  } catch (error) {
    console.error('❌ Error in fetchLegacyLeads:', error.message);
    return [];
  }
}

// Normalize UK postcode for API lookup
function normalizePostcode(postcode) {
  if (!postcode) return null;
  
  // Convert to string and trim
  let normalized = postcode.toString().trim();
  
  // Handle multiple postcodes separated by slashes or other delimiters
  if (normalized.includes('/') || normalized.includes('|') || normalized.includes(',')) {
    // Take the first postcode only
    normalized = normalized.split(/[\/|,]/)[0].trim();
  }
  
  // Remove invalid characters and convert to uppercase
  normalized = normalized.replace(/[^A-Z0-9\s-]/gi, '').toUpperCase();
  
  // Remove dashes and replace with spaces
  normalized = normalized.replace(/-/g, ' ');
  
  // Remove extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // Skip if too short or too long
  if (normalized.length < 3 || normalized.length > 10) {
    return null;
  }
  
  // UK postcode regex pattern - basic validation
  const ukPostcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}$/;
  
  // Try to format properly if it looks like a valid postcode
  if (normalized.length >= 5 && normalized.length <= 8) {
    // Remove all spaces first
    const noSpaces = normalized.replace(/\s/g, '');
    
    // Try to add space in the right place
    if (noSpaces.length === 5) {
      // Format: AB1 2CD
      normalized = noSpaces.slice(0, 3) + ' ' + noSpaces.slice(3);
    } else if (noSpaces.length === 6) {
      // Format: AB12 3CD
      normalized = noSpaces.slice(0, 4) + ' ' + noSpaces.slice(4);
    } else if (noSpaces.length === 7) {
      // Format: AB1C 2DE
      normalized = noSpaces.slice(0, 4) + ' ' + noSpaces.slice(4);
    }
  }
  
  // Final validation
  if (ukPostcodeRegex.test(normalized)) {
    return normalized;
  }
  
  // Return original if we can't normalize it properly
  return normalized.length >= 3 ? normalized : null;
}

// Calculate haversine distance between two coordinates
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Get coordinates for a postcode using postcodes.io
async function getPostcodeCoordinates(postcode) {
  try {
    // Normalize the postcode first
    const normalizedPostcode = normalizePostcode(postcode);
    if (!normalizedPostcode) {
      console.warn(`Invalid postcode format: ${postcode}`);
      return null;
    }
    
    if (normalizedPostcode !== postcode) {
      console.log(`Normalized postcode: ${postcode} -> ${normalizedPostcode}`);
    }
    
    const response = await axios.get(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalizedPostcode)}`);
    if (response.data.status === 200 && response.data.result) {
      return {
        latitude: response.data.result.latitude,
        longitude: response.data.result.longitude
      };
    }
  } catch (error) {
    // Try some common alternatives if the original fails
    if (error.response?.status === 404) {
      const alternatives = generatePostcodeAlternatives(postcode);
      for (const alt of alternatives) {
        try {
          const response = await axios.get(`https://api.postcodes.io/postcodes/${encodeURIComponent(alt)}`);
          if (response.data.status === 200 && response.data.result) {
            console.log(`Found coordinates using alternative format: ${alt} (original: ${postcode})`);
            return {
              latitude: response.data.result.latitude,
              longitude: response.data.result.longitude
            };
          }
        } catch (altError) {
          // Continue to next alternative
        }
      }
    }
    console.error(`Error fetching coordinates for ${postcode}:`, error.message);
  }
  return null;
}

// Generate alternative postcode formats to try
function generatePostcodeAlternatives(postcode) {
  const alternatives = [];
  const normalized = normalizePostcode(postcode);
  
  if (!normalized) return alternatives;
  
  const noSpaces = normalized.replace(/\s/g, '');
  
  if (noSpaces.length >= 5) {
    // Try different spacing patterns
    alternatives.push(noSpaces.slice(0, 2) + ' ' + noSpaces.slice(2));
    alternatives.push(noSpaces.slice(0, 3) + ' ' + noSpaces.slice(3));
    alternatives.push(noSpaces.slice(0, 4) + ' ' + noSpaces.slice(4));
    
    // Try without spaces
    alternatives.push(noSpaces);
  }
  
  return [...new Set(alternatives)]; // Remove duplicates
}

// Check if two names are similar using fuzzy matching
function areNamesSimilar(name1, name2, threshold = 3) {
  if (!name1 || !name2) return false;
  
  // Normalize names: lowercase, trim, remove extra spaces
  const norm1 = name1.toLowerCase().trim().replace(/\s+/g, ' ');
  const norm2 = name2.toLowerCase().trim().replace(/\s+/g, ' ');
  
  // Exact match
  if (norm1 === norm2) return true;
  
  // Fuzzy match using Levenshtein distance
  const distance = levenshtein.get(norm1, norm2);
  return distance <= threshold;
}

// Main analysis function
async function analyseLeads(uploadedLeads, existingLeads, legacyLeads = []) {
  const report = [];
  const distances = [];
  
  // Get coordinates for reference postcode M12 6DA
  const referenceCoords = await getPostcodeCoordinates('M12 6DA');
  if (!referenceCoords) {
    console.warn('Could not get coordinates for reference postcode M12 6DA - distance calculations will be skipped');
  }
  
  // Analyze each uploaded lead
  for (let i = 0; i < uploadedLeads.length; i++) {
    const lead = uploadedLeads[i];
    const row = i + 1; // 1-indexed row number
    
    let duplicateOf = null;
    let reason = null;
    let duplicateType = null; // 'existing' or 'list'
    let distanceMiles = null;
    let farFlag = false;
    
    // Normalize contact info for comparison
    const normalizedPhone = normalizePhone(lead.phone);
    const normalizedEmail = normalizeEmail(lead.email);
    
    // Check for duplicates in existing leads (prioritize phone/email over name)
    for (const existingLead of existingLeads) {
      const existingPhone = normalizePhone(existingLead.phone);
      const existingEmail = normalizeEmail(existingLead.email);

      // Primary duplicate detection: Phone and Email
      const phoneMatch = normalizedPhone && existingPhone && normalizedPhone === existingPhone;
      const emailMatch = normalizedEmail && existingEmail && normalizedEmail === existingEmail;

      // Debug logging for first few leads
      if (i < 3) {
        console.log(`🔍 Row ${row} vs existing lead ${existingLead.id}:`, {
          uploadPhone: normalizedPhone,
          existingPhone: existingPhone,
          uploadEmail: normalizedEmail,
          existingEmail: existingEmail,
          phoneMatch,
          emailMatch
        });
      }

      if (phoneMatch && emailMatch) {
        duplicateOf = existingLead.id || existingLead._id;
        reason = 'phone_and_email';
        duplicateType = 'existing';
        console.log(`✅ Found duplicate: Row ${row} matches existing lead ${duplicateOf} (phone & email)`);
        break;
      } else if (phoneMatch) {
        duplicateOf = existingLead.id || existingLead._id;
        reason = 'phone';
        duplicateType = 'existing';
        console.log(`✅ Found duplicate: Row ${row} matches existing lead ${duplicateOf} (phone)`);
        break;
      } else if (emailMatch) {
        duplicateOf = existingLead.id || existingLead._id;
        reason = 'email';
        duplicateType = 'existing';
        console.log(`✅ Found duplicate: Row ${row} matches existing lead ${duplicateOf} (email)`);
        break;
      }
    }

    // Check for duplicates in legacy leads (only if not already found in CRM)
    if (!duplicateOf && legacyLeads.length > 0) {
      console.log(`🔍 Checking row ${row} (${lead.name}) against ${legacyLeads.length} legacy leads...`);

      for (const legacyLead of legacyLeads) {
        const legacyPhone = normalizePhone(legacyLead.phone);
        const legacyEmail = normalizeEmail(legacyLead.email);

        // Primary duplicate detection: Phone and Email
        const phoneMatch = normalizedPhone && legacyPhone && normalizedPhone === legacyPhone;
        const emailMatch = normalizedEmail && legacyEmail && normalizedEmail === legacyEmail;

        if (phoneMatch && emailMatch) {
          duplicateOf = legacyLead.id;
          reason = 'phone_and_email';
          duplicateType = 'legacy';
          console.log(`🎯 LEGACY MATCH FOUND: Row ${row} (${lead.name}) matches legacy lead ${legacyLead.name} (ID: ${duplicateOf})`);
          console.log(`   📞 Phone: ${normalizedPhone} | ✉️ Email: ${normalizedEmail}`);
          break;
        } else if (phoneMatch) {
          duplicateOf = legacyLead.id;
          reason = 'phone';
          duplicateType = 'legacy';
          console.log(`🎯 LEGACY MATCH FOUND: Row ${row} (${lead.name}) matches legacy lead ${legacyLead.name} (ID: ${duplicateOf})`);
          console.log(`   📞 Phone match: ${normalizedPhone}`);
          break;
        } else if (emailMatch) {
          duplicateOf = legacyLead.id;
          reason = 'email';
          duplicateType = 'legacy';
          console.log(`🎯 LEGACY MATCH FOUND: Row ${row} (${lead.name}) matches legacy lead ${legacyLead.name} (ID: ${duplicateOf})`);
          console.log(`   ✉️ Email match: ${normalizedEmail}`);
          break;
        }
      }

      if (!duplicateOf) {
        console.log(`✅ Row ${row} (${lead.name}) - No legacy matches found`);
      }
    }

    // Check for duplicates within uploaded list (only check previous leads)
    if (!duplicateOf) {
      for (let j = 0; j < i; j++) {
        const prevLead = uploadedLeads[j];
        const prevPhone = normalizePhone(prevLead.phone);
        const prevEmail = normalizeEmail(prevLead.email);
        
        // Primary duplicate detection: Phone and Email
        const phoneMatch = normalizedPhone && prevPhone && normalizedPhone === prevPhone;
        const emailMatch = normalizedEmail && prevEmail && normalizedEmail === prevEmail;
        
        if (phoneMatch && emailMatch) {
          duplicateOf = `row-${j + 1}`;
          reason = 'phone_and_email';
          duplicateType = 'list';
          break;
        } else if (phoneMatch) {
          duplicateOf = `row-${j + 1}`;
          reason = 'phone';
          duplicateType = 'list';
          break;
        } else if (emailMatch) {
          duplicateOf = `row-${j + 1}`;
          reason = 'email';
          duplicateType = 'list';
          break;
        }
      }
    }
    
    // Calculate distance if postcode is provided and we have reference coordinates
    if (lead.postcode && referenceCoords) {
      try {
        const leadCoords = await getPostcodeCoordinates(lead.postcode);
        if (leadCoords) {
          distanceMiles = haversineDistance(
            referenceCoords.latitude,
            referenceCoords.longitude,
            leadCoords.latitude,
            leadCoords.longitude
          );
          distances.push(distanceMiles);
          farFlag = distanceMiles > 150;
        }
      } catch (postcodeError) {
        console.warn(`Skipping distance calculation for lead ${row} due to postcode error:`, postcodeError.message);
      }
    }
    
    // Add to report if duplicate found OR if far (but only if we have distance data)
    if (duplicateOf) {
      report.push({
        row,
        lead: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          postcode: lead.postcode
        },
        duplicateOf,
        reason,
        duplicateType,
        distanceMiles,
        farFlag
      });
    } else if (farFlag && distanceMiles !== null) {
      // Only report far leads if we actually calculated distance
      report.push({
        row,
        lead: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          postcode: lead.postcode
        },
        duplicateOf: null,
        reason: null,
        duplicateType: null,
        distanceMiles,
        farFlag
      });
    }
  }
  
  // Calculate distance statistics
  const distanceStats = {
    count: distances.length,
    avgMiles: distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0,
    minMiles: distances.length > 0 ? Math.min(...distances) : 0,
    maxMiles: distances.length > 0 ? Math.max(...distances) : 0,
    within50: distances.filter(d => d <= 50).length,
    within150: distances.filter(d => d <= 150).length
  };
  
  return {
    report,
    distanceStats
  };
}

module.exports = { analyseLeads, fetchLegacyLeads }; 