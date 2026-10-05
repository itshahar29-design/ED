import { DbClient } from '../db/client.js';

export async function checkIdempotency(
  db: DbClient,
  key: string,
  schoolId: number,
  userId: number
): Promise<{ statusCode: number; body: any } | null> {
  const res = await db.query(
    'SELECT response_code, response_body FROM idempotency_keys WHERE key = $1 AND school_id = $2',
    [key, schoolId]
  );
  if (res.rows.length > 0) {
    try {
      return {
        statusCode: res.rows[0].response_code,
        body: JSON.parse(res.rows[0].response_body),
      };
    } catch {
      return {
        statusCode: res.rows[0].response_code,
        body: res.rows[0].response_body,
      };
    }
  }
  return null;
}

export async function saveIdempotency(
  db: DbClient,
  key: string,
  schoolId: number,
  userId: number,
  path: string,
  statusCode: number,
  body: any
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO idempotency_keys (key, school_id, user_id, path, response_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO NOTHING`,
      [key, schoolId, userId, path, statusCode, JSON.stringify(body)]
    );
  } catch (err) {
    console.error('Idempotency saqlashda xatolik:', err);
  }
}
