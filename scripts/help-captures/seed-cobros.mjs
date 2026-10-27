/**
 * Cobros de ejemplo para las capturas del módulo «Cobros».
 *
 * Conectar Mercado Pago de verdad exige una cuenta del proveedor (la app
 * verifica la clave contra su API), así que la empresa de ejemplo recibe una
 * conexión de PRUEBA y cinco links con distintos estados escritos directo en
 * la base. Sólo corre si hay `DATABASE_URL` (el grabador del release la
 * tiene); sin ella, las demos de cobros muestran su ilustración de respaldo.
 * Idempotente: si la empresa ya tiene una conexión de cobro, no hace nada.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Mismo formato que el secret-box del API (SEC-20); sin clave, texto plano. */
function encryptSecret(plain, key) {
    if (!key) return plain;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', createHash('sha256').update(key, 'utf8').digest(), iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export async function seedCobros(tenantId) {
    if (!process.env.DATABASE_URL) return false;
    const { Client } = createRequire(path.join(here, '../../apps/api/package.json'))('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
        const exists = await c.query(`select id from connections where tenant_id = $1 and provider in ('mercadopago', 'wompi') limit 1`, [tenantId]);
        if (exists.rows.length) return true;
        const user = (await c.query(`select user_id from memberships where tenant_id = $1 and role = 'admin' order by user_id limit 1`, [tenantId])).rows[0]?.user_id;
        const list = (await c.query(`select id from lists where tenant_id = $1 and slug = 'facturas' and deleted_at is null limit 1`, [tenantId])).rows[0]?.id;
        if (!user || !list) return false;
        const conn = (
            await c.query(
                `insert into connections (tenant_id, provider, name, base_url, auth_type, config, secrets, visibility, created_by, last_check_at, last_check_ok)
                 values ($1, 'mercadopago', 'Mercado Pago · Café Aurora', '', 'none', $2, $3, 'workspace', $4, now(), true) returning id`,
                [tenantId, JSON.stringify({ fields: { test_mode: 'true' }, account_label: 'Café Aurora' }), JSON.stringify({ token: encryptSecret('TEST-0000000000000000-demo', process.env.SECRETS_KEY ?? '') }), user],
            )
        ).rows[0].id;
        const recs = (await c.query(`select id from records where tenant_id = $1 and list_id = $2 and deleted_at is null and parent_id is null order by id limit 6`, [tenantId, list])).rows.map((r) => r.id);
        if (!recs.length) return false;
        const rows = [
            { title: 'Factura F-0001', amount: 250000, status: 'paid', paid: 250000, method: 'PSE', days: -6 },
            { title: 'Factura F-0002', amount: 1250000, status: 'pending', days: -2 },
            { title: 'Factura F-0003', amount: 480000, status: 'paid', paid: 480000, method: 'Tarjeta de crédito', days: -4 },
            { title: 'Factura F-0004', amount: 320000, status: 'expired', days: -20 },
            { title: 'Factura F-0005', amount: 760000, status: 'mismatch', paid: 700000, method: 'Nequi', days: -3 },
        ];
        for (const [i, r] of rows.entries()) {
            await c.query(
                `insert into payment_links (tenant_id, connection_id, provider, list_id, record_id, external_id, url, title, amount, currency, status, paid_amount, paid_at, method, payment_id, created_by, created_at, updated_at)
                 values ($1, $2, 'mercadopago', $3, $4, $5, $6, $7, $8, 'COP', $9, $10, $11, $12, $13, $14, now() + ($15 || ' days')::interval, now())`,
                [
                    tenantId, conn, list, recs[i % recs.length], `demo-pref-${tenantId}-${i}`, `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=demo-${i}`, r.title, r.amount, r.status,
                    r.paid ?? null, r.paid ? new Date(Date.now() + (r.days + 1) * 864e5) : null, r.method ?? null, r.paid ? `1300${i}55${i}` : null, user, String(r.days),
                ],
            );
        }
        return true;
    } finally {
        await c.end();
    }
}
