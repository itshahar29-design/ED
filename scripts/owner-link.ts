import crypto from 'crypto';
import { getDb } from '../src/db/client.js';
import { logAudit } from '../src/modules/audit/audit.service.js';
import { hashSessionToken } from '../src/modules/auth/crypto.js';

async function main() {
  const db = await getDb();

  // Find owner user
  let ownerRes = await db.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  let ownerId: number;

  if (ownerRes.rows.length === 0) {
    const created = await db.query(
      "INSERT INTO users (username, role, status) VALUES ('owner', 'owner', 'active') RETURNING id"
    );
    ownerId = created.rows[0].id;
  } else {
    ownerId = ownerRes.rows[0].id;
  }

  // Generate 10-minute one-time token
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.query(
    `INSERT INTO sessions (id, user_id, school_id, token_hash, expires_at)
     VALUES ($1, $2, NULL, $3, $4)`,
    [tokenHash, ownerId, tokenHash, expiresAt.toISOString()]
  );

  await logAudit(db, {
    school_id: null,
    user_id: ownerId,
    action: 'BREAK_GLASS_OWNER_LINK',
    entity: 'session',
    entity_id: tokenHash,
    details: { expires_at: expiresAt.toISOString() },
  });

  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  console.log('----------------------------------------------------');
  console.log('🚨 FAVQULODDA KIRISH (BREAK-GLASS) HAVOLASI');
  console.log('Ushbu havola 10 daqiqa yaroqli va faqat bitta marta ishlatiladi:');
  console.log(`${baseUrl}/?token=${token}`);
  console.log('----------------------------------------------------');

  await db.close();
}

main().catch((err) => {
  console.error('Xatolik:', err);
  process.exit(1);
});
