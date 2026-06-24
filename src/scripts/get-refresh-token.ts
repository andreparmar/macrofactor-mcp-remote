/**
 * Run this locally ONCE to capture your Firebase refresh token.
 * The refresh token is safe to store in Railway — it does NOT contain your password.
 *
 * Usage:
 *   MACROFACTOR_USERNAME=you@example.com MACROFACTOR_PASSWORD=yourpass npm run get-refresh-token
 *
 * Then set FIREBASE_REFRESH_TOKEN in Railway to the printed value.
 */
import { MacroFactorClient } from '../lib/api/index.js';

const username = process.env.MACROFACTOR_USERNAME;
const password = process.env.MACROFACTOR_PASSWORD;

if (!username || !password) {
  console.error('Set MACROFACTOR_USERNAME and MACROFACTOR_PASSWORD env vars before running this script.');
  process.exit(1);
}

console.log(`Logging in as ${username}...`);
const client = await MacroFactorClient.login(username, password);
const token = client.getRefreshToken();

console.log('\n✓ Login successful. Copy the token below into Railway as FIREBASE_REFRESH_TOKEN:\n');
console.log(token);
console.log('\nYour password is NOT stored anywhere — only this refresh token is needed.');
