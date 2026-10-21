import { setAppCheckToken } from './firestore';
import { COLOR, discordTime, notify } from '../notify';

// MacroFactor's iOS App Check registration (from a WRAITH capture of the app's own exchange).
const PROJECT_ID = 'sbs-diet-app';
const IOS_APP_ID = '1:122915645538:ios:88bc57c3d5ec0262b8c93b';
const EXCHANGE_URL = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/apps/${IOS_APP_ID}:exchangeDeviceCheckToken`;
const APP_HEADERS = {
  'Content-Type': 'application/json',
  'X-Ios-Bundle-Identifier': 'com.sbs.diet',
  'User-Agent': 'MacroFactor/879 CFNetwork/3896.100.1.2.1 Darwin/27.0.0',
};

const RETRY_MIN_MS = 60_000; // 1 min
const RETRY_MAX_MS = 60 * 60_000; // 1 h

let retryMs = RETRY_MIN_MS;
let failures = 0; // consecutive failed exchanges

/** Trade the captured DeviceCheck device_token for a fresh App Check token. */
async function exchange(deviceToken: string, apiKey: string): Promise<{ token: string; ttlMs: number }> {
  const resp = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { ...APP_HEADERS, 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({ limited_use: false, device_token: deviceToken }),
  });
  if (!resp.ok) {
    throw new Error(`App Check exchange failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  }
  const data = (await resp.json()) as { token: string; ttl: string };
  return { token: data.token, ttlMs: parseFloat(data.ttl) * 1000 }; // ttl is "86400s"
}

/**
 * Keep the App Check token fresh with no phone involved: exchange at startup, then again at half the
 * token's lifetime. On failure the current token is kept (a manual /admin/app-check-token push still
 * works) and the exchange retries with backoff — a persistent failure means the device_token has gone
 * stale and needs a new WRAITH capture.
 */
export function startAppCheckRefresher(deviceToken: string, apiKey: string): void {
  const run = async () => {
    try {
      const { token, ttlMs } = await exchange(deviceToken, apiKey);
      setAppCheckToken(token);
      const next = ttlMs / 2;
      console.log(`App Check token refreshed (ttl ${Math.round(ttlMs / 3_600_000)}h) — next refresh in ${Math.round(next / 60_000)}m`);
      void notify({
        title: failures ? '✅ App Check refresh recovered' : '✅ App Check token refreshed',
        color: COLOR.ok,
        fields: [
          { name: 'Valid until', value: discordTime(Date.now() + ttlMs), inline: true },
          { name: 'Next refresh', value: discordTime(Date.now() + next, 'R'), inline: true },
          ...(failures ? [{ name: 'Failed attempts before recovery', value: String(failures) }] : []),
        ],
      });
      retryMs = RETRY_MIN_MS;
      failures = 0;
      setTimeout(run, next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`⚠ App Check auto-refresh FAILED — ${message} — retrying in ${Math.round(retryMs / 60_000)}m. If this persists, re-capture APPCHECK_DEVICE_TOKEN with WRAITH.`);
      failures++;
      // Alert on the first failure and once more when backoff reaches its cap (~1h of failing), not every retry.
      if (failures === 1 || (retryMs < RETRY_MAX_MS && retryMs * 2 >= RETRY_MAX_MS)) {
        void notify({
          title: failures === 1 ? '⚠️ App Check refresh failed' : '🚨 App Check refresh still failing',
          color: failures === 1 ? COLOR.warn : COLOR.error,
          description:
            '```' + message.replace(/\s+/g, ' ').slice(0, 300) + '```\n' +
            'Retrying automatically. If this keeps failing, re-capture `APPCHECK_DEVICE_TOKEN` with WRAITH.',
          fields: [
            { name: 'Attempt', value: String(failures), inline: true },
            { name: 'Next retry', value: discordTime(Date.now() + retryMs, 'R'), inline: true },
          ],
        });
      }
      setTimeout(run, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    }
  };
  void run();
}
