#!/usr/bin/env node
// Prints the hash to paste into lib/auth.js (passwordHash) or to set as HM_PASSWORD_HASH on a server.
// Usage: node tools/set-password.js "NewPassword"
const { hashPassword } = require('../lib/auth');
const pw = process.argv[2];
if (!pw) { console.error('Usage: node tools/set-password.js "NewPassword"'); process.exit(1); }
console.log(hashPassword(pw));
