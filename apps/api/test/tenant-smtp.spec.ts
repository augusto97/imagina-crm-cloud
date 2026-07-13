import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { tenants } from '../src/db/schema';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { startPostgres, type TestPg } from './helpers/containers';

describe('TenantSmtpService (Postgres real)', () => {
    let pg: TestPg;
    let smtp: TenantSmtpService;
    let tenantId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        smtp = new TenantSmtpService(pg.db, loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' }));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    beforeEach(async () => {
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `smtp-${counter}`, name: 'ACME', plan: 'trial', status: 'trialing' })
            .returning();
        tenantId = t!.id;
    });

    it('sin config: GET marca configured=false y getForSend devuelve null', async () => {
        expect((await smtp.get(tenantId)).configured).toBe(false);
        expect(await smtp.getForSend(tenantId)).toBeNull();
    });

    it('roundtrip: guarda, el GET no expone la contraseña y el envío la recupera', async () => {
        const pub = await smtp.update(tenantId, {
            host: 'smtp.acme.com',
            port: 465,
            secure: true,
            user: 'ventas@acme.com',
            pass: 'super-secreta',
            from: 'Acme <ventas@acme.com>',
        });
        expect(pub).toMatchObject({ configured: true, host: 'smtp.acme.com', port: 465, secure: true });
        expect('pass' in pub).toBe(false);

        // Para el ENVÍO la contraseña vuelve en claro.
        const send = await smtp.getForSend(tenantId);
        expect(send?.pass).toBe('super-secreta');

        // En REPOSO está cifrada (la fila cruda no contiene el texto plano).
        const [row] = await pg.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        expect(JSON.stringify(row!.settings)).not.toContain('super-secreta');
    });

    it('PATCH con pass vacío conserva la contraseña previa; clear vuelve al fallback', async () => {
        await smtp.update(tenantId, {
            host: 'smtp.acme.com', port: 587, secure: false, user: 'u', pass: 'primera', from: 'a@acme.com',
        });
        await smtp.update(tenantId, {
            host: 'smtp2.acme.com', port: 587, secure: false, user: 'u', pass: '', from: 'a@acme.com',
        });
        const send = await smtp.getForSend(tenantId);
        expect(send?.host).toBe('smtp2.acme.com');
        expect(send?.pass).toBe('primera');

        await smtp.clear(tenantId);
        expect(await smtp.getForSend(tenantId)).toBeNull();
        expect((await smtp.get(tenantId)).configured).toBe(false);
    });
});
