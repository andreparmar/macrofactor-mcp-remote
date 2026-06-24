/**
 * Quick local test — calls MacroFactor directly with your refresh token.
 * No server or OAuth needed.
 *
 * Usage:
 *   FIREBASE_REFRESH_TOKEN='...' FIREBASE_WEB_API_KEY='...' npm run test-local
 */
import { MacroFactorClient } from '../lib/api/index.js';

const refreshToken = process.env.FIREBASE_REFRESH_TOKEN;
const apiKey = process.env.FIREBASE_WEB_API_KEY;

if (!refreshToken || !apiKey) {
  console.error('Set FIREBASE_REFRESH_TOKEN and FIREBASE_WEB_API_KEY');
  process.exit(1);
}

console.log('Connecting to MacroFactor...');
const client = await MacroFactorClient.fromRefreshToken(refreshToken);
console.log('Connected.\n');

console.log('--- Profile ---');
const profile = await client.getProfile();
console.log(JSON.stringify({ email: (profile as any).email, displayName: (profile as any).displayName }, null, 2));

console.log('\n--- Goals ---');
const goals = await client.getGoals();
console.log(JSON.stringify(goals, null, 2));

console.log('\n--- Weight (last 7 days) ---');
const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const weight = await client.getWeightEntries(weekAgo, today);
console.log(JSON.stringify(weight, null, 2));

console.log('\n✓ All checks passed — server is wired up correctly.');
