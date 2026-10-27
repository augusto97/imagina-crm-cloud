#!/usr/bin/env node
/**
 * Crea la cuenta y la empresa de ejemplo para las capturas (si no existen):
 * alta por la API como cualquier persona, y el correo marcado como confirmado
 * directo en la base (si no, el aviso «Confirma tu correo» saldría en todas
 * las capturas).
 *
 *   DATABASE_URL=... node scripts/help-captures/prepare.mjs --api http://localhost:3001 \
 *        --email demo@ejemplo.test --password Clave-de-demo-1
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > -1 ? process.argv[i + 1] : d;
};
const API = arg('api', 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = arg('email', 'demo@ejemplo.test');
const PASSWORD = arg('password', 'Clave-de-demo-1');
const NAME = arg('name', 'Laura Gómez');
const COMPANY = arg('company', 'Café Aurora');

const res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: NAME, workspace_name: COMPANY }),
});
if (res.ok) console.log(`cuenta creada: ${EMAIL} · empresa «${COMPANY}»`);
else if (res.status === 409) console.log(`la cuenta ${EMAIL} ya existía`);
else throw new Error(`alta falló: ${res.status} ${await res.text()}`);

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL para confirmar el correo.');
const { Client } = createRequire(path.join(root, 'apps/api/package.json'))('pg');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE lower(email) = lower($1)', [EMAIL]);
await db.end();
console.log('correo confirmado');
