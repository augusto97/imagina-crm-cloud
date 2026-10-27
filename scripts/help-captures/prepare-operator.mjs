#!/usr/bin/env node
/**
 * Cuenta de OPERADOR para las capturas del módulo «Plataforma».
 *
 * La consola de plataforma exige un superadmin (`PLATFORM_SUPERADMINS`) y el
 * alta pública rechaza esos correos a propósito (SEC-04), así que se escribe
 * directo en la base: contraseña conocida, correo verificado y una empresa
 * propia (la consola vive dentro de la app). El API ya pudo haber creado la
 * fila del usuario al arrancar; en ese caso sólo se le pone la contraseña.
 *
 *   DATABASE_URL=… node scripts/help-captures/prepare-operator.mjs --email operador@ejemplo.test --password …
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(here, '../../apps/api/package.json'));
const { Client } = req('pg');
const argon2 = req('argon2');

const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
};
const email = arg('email');
const password = arg('password');
if (!email || !password || !process.env.DATABASE_URL) {
    console.error('uso: DATABASE_URL=… prepare-operator.mjs --email … --password …');
    process.exit(2);
}

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
    const hash = await argon2.hash(password);
    const existing = (await c.query('select id from users where lower(email) = lower($1)', [email])).rows[0];
    const userId = existing
        ? (await c.query('update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()), disabled_at = null where id = $1 returning id', [existing.id, hash])).rows[0].id
        : (await c.query(`insert into users (email, password_hash, name, email_verified_at) values ($1, $2, 'Operador', now()) returning id`, [email, hash])).rows[0].id;
    const member = (await c.query('select 1 from memberships where user_id = $1 limit 1', [userId])).rows[0];
    if (!member) {
        const tenant = (await c.query(`insert into tenants (slug, name) values ('operador-demo', 'Operación') on conflict (slug) do update set name = excluded.name returning id`)).rows[0].id;
        await c.query(`insert into memberships (user_id, tenant_id, role) values ($1, $2, 'admin') on conflict do nothing`, [userId, tenant]);
    }
    console.log(`operador listo: ${email}`);
} finally {
    await c.end();
}
