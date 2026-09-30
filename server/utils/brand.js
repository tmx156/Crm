/**
 * The agency a client-facing page or email should be branded as.
 *
 * This CRM books for several agencies (Camry, Antara, John Ryland), so a
 * hard-coded name is wrong for most clients. The brand follows the account
 * the email was actually sent FROM - the same name the client sees in their
 * inbox's From line - so the email body, the gallery page and the From name
 * always agree, including when a lead's own mailbox is unavailable and the
 * resolver sends from another agency's account instead.
 */

const { getAccountDisplayName } = require('./emailService');

/**
 * @param {string} accountEmail  the sending Gmail address
 * @returns {{ name: string, main: string, sub: string|null }}
 *   name - "Antara Models", for running text
 *   main / sub - the two-line wordmark, "ANTARA" over "MODELS"
 */
function brandForAccount(accountEmail) {
  const name = getAccountDisplayName(accountEmail);
  const m = /^(.*\S)\s+(models?)$/i.exec(name);
  return m
    ? { name, main: m[1].toUpperCase(), sub: m[2].toUpperCase() }
    : { name, main: name.toUpperCase(), sub: null };
}

module.exports = { brandForAccount };
