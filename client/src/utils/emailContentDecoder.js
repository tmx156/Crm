// Email Content Decoder for Client-Side Rendering
// This utility handles decoding of email content that may contain
// MIME headers, HTML, quoted-printable encoding, and other artifacts

export function decodeEmailContent(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  let decoded = content;

  // Step 1: Remove MIME boundaries and headers
  decoded = decoded.replace(/^--[A-Za-z0-9._-]+$/gm, '');
  decoded = decoded.replace(/^--[A-Za-z0-9._-]+--$/gm, '');
  decoded = decoded.replace(/^Content-Type:.*$/gm, '');
  decoded = decoded.replace(/^Content-Transfer-Encoding:.*$/gm, '');
  decoded = decoded.replace(/^Content-Disposition:.*$/gm, '');
  decoded = decoded.replace(/^boundary=.*$/gm, '');
  decoded = decoded.replace(/^charset=.*$/gm, '');
  decoded = decoded.replace(/^MIME-Version:.*$/gm, '');
  decoded = decoded.replace(/^X-.*$/gm, '');
  decoded = decoded.replace(/^Message-ID:.*$/gm, '');
  decoded = decoded.replace(/^Date:.*$/gm, '');
  decoded = decoded.replace(/^From:.*$/gm, '');
  decoded = decoded.replace(/^To:.*$/gm, '');
  decoded = decoded.replace(/^Subject:.*$/gm, '');

  // Step 2: Decode quoted-printable encoding
  decoded = decodeQuotedPrintable(decoded);

  // Step 3: Clean up HTML tags and entities
  decoded = cleanHtmlContent(decoded);

  // Step 4: Clean up encoding artifacts
  decoded = decoded.replace(/^\s*=\r?\n/gm, ''); // Soft line breaks
  decoded = decoded.replace(/^=\r?\n/gm, ''); // Hard line breaks

  // Step 5: Final cleanup
  decoded = decoded.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
  decoded = decoded.replace(/[ \t]+/g, ' '); // Multiple spaces to single
  decoded = decoded.replace(/^\s+|\s+$/gm, ''); // Trim lines
  decoded = decoded.trim();

  return decoded;
}

function decodeQuotedPrintable(str) {
  if (!str) return '';

  try {
    // Replace =\r\n or =\n (soft line breaks)
    str = str.replace(/=\r?\n/g, '');

    // Decode =XX hex codes
    str = str.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    return str;
  } catch (error) {
    console.error('Error decoding quoted-printable:', error);
    return str;
  }
}

function cleanHtmlContent(str) {
  if (!str) return '';

  // Remove HTML tags but preserve line breaks
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/<\/?(div|p|h[1-6]|li|tr)[^>]*>/gi, '\n');
  str = str.replace(/<\/td>/gi, '\t');
  str = str.replace(/<hr[^>]*>/gi, '\n---\n');
  
  // Remove all other HTML tags
  str = str.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#34;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&mdash;': '-',
    '&ndash;': '-',
    '&hellip;': '...',
    // Fix common UTF-8 encoding issues
    'â€™': "'",
    'â€œ': '"',
    'â€': '"',
    'â€"': '-',
    'â€"': '-',
    'â€¦': '...',
    'â': ''
  };

  for (const [entity, char] of Object.entries(entities)) {
    str = str.replace(new RegExp(entity, 'g'), char);
  }

  // Decode numeric entities
  str = str.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(dec);
  });
  str = str.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return str;
}

export function isEmailContentEncoded(content) {
  if (!content) return false;
  
  // Check for common encoding indicators
  const hasMimeHeaders = /^Content-Type:|^Content-Transfer-Encoding:|^charset=/m.test(content);
  const hasQuotedPrintable = /=([0-9A-F]{2})/i.test(content);
  const hasHtmlTags = /<[^>]+>/g.test(content);
  const hasMimeBoundaries = /^--[A-Za-z0-9._-]+$/m.test(content);
  
  return hasMimeHeaders || hasQuotedPrintable || hasHtmlTags || hasMimeBoundaries;
}

export function getEmailContentPreview(content, maxLength = 200) {
  if (!content) return '';
  
  const decoded = decodeEmailContent(content);
  
  if (decoded.length <= maxLength) {
    return decoded;
  }
  
  // Find a good breaking point (end of sentence or word)
  let preview = decoded.substring(0, maxLength);
  const lastSentence = preview.lastIndexOf('.');
  const lastSpace = preview.lastIndexOf(' ');
  
  if (lastSentence > maxLength * 0.7) {
    preview = decoded.substring(0, lastSentence + 1);
  } else if (lastSpace > maxLength * 0.8) {
    preview = decoded.substring(0, lastSpace);
  }
  
  return preview + (decoded.length > maxLength ? '...' : '');
}
