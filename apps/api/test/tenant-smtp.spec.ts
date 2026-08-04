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

    // ── v0.1.150 — el SMTP configurado pero INUSABLE no puede fingir que anda ──
    //
    // Reproducción del reporte del usuario ("le configuro SMTP y no envía"): si
    // la contraseña guardada no descifra con la `SECRETS_KEY` actual, todo el
    // camino degradaba en silencio al transporte `log` y la app respondía
    // "enviado". Ahora el GET lo dice, guardar sin contraseña se rechaza y el
    // envío falla con un mensaje accionable.
    describe('config guardada con OTRA clave de cifrado', () => {
        let conOtraClave: TenantSmtpService;

        beforeEach(async () => {
            await smtp.update(tenantId, {
                host: 'smtp.acme.com',
                port: 587,
                secure: false,
                user: 'ventas@acme.com',
                pass: 'super-secreta',
                from: 'Acme <ventas@acme.com>',
            });
            conOtraClave = new TenantSmtpService(pg.db, loadEnv({ SECRETS_KEY: 'una-clave-completamente-distinta' }));
        });

        it('el panel NO se rompe: informa la config y que hay que reescribir la contraseña', async () => {
            const pub = await conOtraClave.get(tenantId);
            expect(pub).toMatchObject({
                configured: true,
                host: 'smtp.acme.com',
                password_unreadable: true,
            });
        });

        it('el ENVÍO falla con un mensaje accionable (antes: se iba al logger)', async () => {
            await expect(conOtraClave.getForSend(tenantId)).rejects.toThrow(/no se puede usar/i);
        });

        it('guardar sin escribir la contraseña se rechaza (no deja el SMTP roto otra vez)', async () => {
            await expect(
                conOtraClave.update(tenantId, {
                    host: 'smtp.acme.com',
                    port: 587,
                    secure: false,
                    user: 'ventas@acme.com',
                    pass: '',
                    from: 'Acme <ventas@acme.com>',
                }),
            ).rejects.toThrow(/contraseña/i);
        });

        it('escribiendo la contraseña de nuevo vuelve a funcionar', async () => {
            const pub = await conOtraClave.update(tenantId, {
                host: 'smtp.acme.com',
                port: 587,
                secure: false,
                user: 'ventas@acme.com',
                pass: 'otra-vez',
                from: 'Acme <ventas@acme.com>',
            });
            expect(pub.password_unreadable).toBe(false);
            expect((await conOtraClave.getForSend(tenantId))?.pass).toBe('otra-vez');
        });
    });
});
