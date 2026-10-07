import crypto from 'crypto';

export interface FakeUserOptions {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function generateFakeInitData(
  user: FakeUserOptions,
  botToken: string,
  options?: { auth_date?: number; start_param?: string; query_id?: string }
): string {
  const authDate = options?.auth_date ?? Math.floor(Date.now() / 1000);
  const params: Record<string, string> = {
    auth_date: String(authDate),
    user: JSON.stringify(user),
  };

  if (options?.query_id) {
    params.query_id = options.query_id;
  }
  if (options?.start_param) {
    params.start_param = options.start_param;
  }

  // Sort keys alphabetically
  const keys = Object.keys(params).sort();
  const dataCheckArr: string[] = [];
  for (const k of keys) {
    dataCheckArr.push(`${k}=${params[k]}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  // secret = HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const urlParams = new URLSearchParams(params);
  urlParams.set('hash', hash);
  return urlParams.toString();
}

// CLI usage if run directly
if (process.argv[1]?.endsWith('fake-initdata.ts') || process.argv[1]?.endsWith('fake-initdata.js')) {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  const fake = generateFakeInitData({ id: 12345678, first_name: 'Test', username: 'tester' }, token);
  console.log('Fake initData:\n', fake);
}
