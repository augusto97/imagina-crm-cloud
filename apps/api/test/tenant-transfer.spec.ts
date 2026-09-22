import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import {
    activity,
    attachments,
    auditLog,
    automationHooks,
    automations,
    comments,
    connections,
    dashboards,
    emailUsage,
    fields,
    listGroups,
    lists,
    memberships,
    mentions,
    portalLinks,
    publicLists,
    records,
    recurrences,
    relations,
    savedViews,
    tenants,
    users,
} from '../src/db/schema';
import { LocalFileStorage } from '../src/files/file-storage';
import { TenantTransferService } from '../src/platform/tenant-transfer.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.197 (ADR-S23) — migrar UNA empresa entre instancias, con Postgres real.
 *
 * La propiedad que hay que demostrar es una sola y es la difícil: después de
 * importar, NINGUNA referencia sigue apuntando a un id viejo. Por eso el
 * destino es la MISMA base (los ids nuevos caen en otro rango y cualquier
 * referencia sin traducir apuntaría a la empresa original, que sigue ahí —
 * exactamente el fallo silencioso que se quiere descartar).
 */
const KEY = 'clave-de-test-para-secretos-32b';

describe('Migración de empresa (v0.1.197)', () => {
    let pg: TestPg;
    let svc: TenantTransferService;
    let work: string;
    let uploads: string;
    let storage: LocalFileStorage;

    // Origen
    let tenantA: number;
    let anaId: number;
    let carlosId: number;
    let clientesId: number;
    let facturasId: number;
    let nombreFieldId: number;
    let dueñoFieldId: number;
    let adjuntoFieldId: number;
    let relFieldId: number;
    let estadoFieldId: number;
    let clienteRecId: number;
    let subtareaRecId: number;
    let facturaRecId: number;
    let attachmentId: number;
    let connectionId: number;
    let viewId: number;
    let hookToken: string;
    let publicToken: string;

    // Destino
    let tenantB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        work = mkdtempSync(path.join(tmpdir(), 'transfers-'));
        uploads = mkdtempSync(path.join(tmpdir(), 'uploads-'));
        storage = new LocalFileStorage(uploads);
        svc = new TenantTransferService(
            pg.db,
            loadEnv({ SECRETS_KEY: KEY, TRANSFERS_DIR: work }),
            storage,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantA = t!.id;
        const [ana] = await pg.db
            .insert(users)
            .values({ email: 'ana@acme.test', passwordHash: 'hash-ana', name: 'Ana' })
            .returning();
        const [carlos] = await pg.db
            .insert(users)
            .values({ email: 'carlos@acme.test', passwordHash: 'hash-carlos', name: 'Carlos' })
            .returning();
        anaId = ana!.id;
        carlosId = carlos!.id;
        await pg.db.insert(memberships).values([
            { userId: anaId, tenantId: tenantA, role: 'admin' },
            { userId: carlosId, tenantId: tenantA, role: 'agent' },
        ]);

        const [grupo] = await pg.db
            .insert(listGroups)
            .values({ tenantId: tenantA, name: 'Comercial', icon: 'briefcase' })
            .returning();
        const [clientes] = await pg.db
            .insert(lists)
            .values({ tenantId: tenantA, slug: 'clientes', name: 'Clientes', groupId: grupo!.id })
            .returning();
        const [facturas] = await pg.db
            .insert(lists)
            .values({ tenantId: tenantA, slug: 'facturas', name: 'Facturas' })
            .returning();
        clientesId = clientes!.id;
        facturasId = facturas!.id;

        const insertedFields = await pg.db
            .insert(fields)
            .values([
                { tenantId: tenantA, listId: clientesId, slug: 'nombre', label: 'Nombre', type: 'text' },
                { tenantId: tenantA, listId: clientesId, slug: 'dueno', label: 'Dueño', type: 'user' },
                { tenantId: tenantA, listId: clientesId, slug: 'adjunto', label: 'Adjunto', type: 'file' },
                { tenantId: tenantA, listId: facturasId, slug: 'cliente', label: 'Cliente', type: 'relation' },
                { tenantId: tenantA, listId: facturasId, slug: 'estado', label: 'Estado', type: 'select' },
            ])
            .returning();
        nombreFieldId = insertedFields[0]!.id;
        dueñoFieldId = insertedFields[1]!.id;
        adjuntoFieldId = insertedFields[2]!.id;
        relFieldId = insertedFields[3]!.id;
        estadoFieldId = insertedFields[4]!.id;
        // La relación apunta a la OTRA lista: su config lleva un list id.
        await pg.db
            .update(fields)
            .set({ config: { target_list_id: clientesId } })
            .where(eq(fields.id, relFieldId));

        // Adjunto con bytes reales.
        const key = `t${tenantA}/archivo.txt`;
        await storage.write(key, Readable.from(['contenido del adjunto']));
        const [att] = await pg.db
            .insert(attachments)
            .values({
                tenantId: tenantA,
                filename: 'contrato.txt',
                mime: 'text/plain',
                sizeBytes: 21,
                storageKey: key,
                createdBy: anaId,
            })
            .returning();
        attachmentId = att!.id;

        const [conn] = await pg.db
            .insert(connections)
            .values({
                tenantId: tenantA,
                name: 'Gateway',
                baseUrl: 'https://was.example.test',
                authType: 'bearer',
                secrets: { credential: 'enc:v1:loquesea' },
                createdBy: anaId,
            })
            .returning();
        connectionId = conn!.id;

        const [cliente] = await pg.db
            .insert(records)
            .values({
                tenantId: tenantA,
                listId: clientesId,
                createdBy: anaId,
                data: {
                    [`f${nombreFieldId}`]: 'Cliente Uno',
                    [`f${dueñoFieldId}`]: anaId,
                    [`f${adjuntoFieldId}`]: [attachmentId],
                },
            })
            .returning();
        clienteRecId = cliente!.id;
        const [subtarea] = await pg.db
            .insert(records)
            .values({
                tenantId: tenantA,
                listId: clientesId,
                createdBy: anaId,
                parentId: clienteRecId,
                data: { [`f${nombreFieldId}`]: 'Subtarea' },
            })
            .returning();
        subtareaRecId = subtarea!.id;
        const [factura] = await pg.db
            .insert(records)
            .values({
                tenantId: tenantA,
                listId: facturasId,
                createdBy: anaId,
                data: { [`f${estadoFieldId}`]: 'pendiente' },
            })
            .returning();
        facturaRecId = factura!.id;
        // Descripción rica con las tres referencias vivas.
        await pg.db
            .update(records)
            .set({
                description: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { type: 'mentionUser', attrs: { id: anaId, label: 'Ana' } },
                                { type: 'mentionRecord', attrs: { id: clienteRecId } },
                            ],
                        },
                        { type: 'imageBlock', attrs: { fileId: attachmentId } },
                    ],
                } as never,
            })
            .where(eq(records.id, facturaRecId));

        await pg.db.insert(relations).values({
            tenantId: tenantA,
            fieldId: relFieldId,
            sourceRecordId: facturaRecId,
            targetRecordId: clienteRecId,
        });

        const [view] = await pg.db
            .insert(savedViews)
            .values({
                tenantId: tenantA,
                listId: facturasId,
                name: 'Por estado',
                type: 'kanban',
                config: { group_by_field_id: estadoFieldId },
            })
            .returning();
        viewId = view!.id;

        const [comentario] = await pg.db
            .insert(comments)
            .values({
                tenantId: tenantA,
                listId: clientesId,
                recordId: clienteRecId,
                userId: anaId,
                body: '@carlos revisá esto',
            })
            .returning();
        await pg.db.insert(comments).values({
            tenantId: tenantA,
            listId: clientesId,
            recordId: clienteRecId,
            userId: carlosId,
            body: 'listo',
            parentId: comentario!.id,
        });
        await pg.db.insert(mentions).values({
            tenantId: tenantA,
            commentId: comentario!.id,
            listId: clientesId,
            recordId: clienteRecId,
            mentionedUserId: carlosId,
            authorUserId: anaId,
            snippet: 'revisá esto',
        });
        await pg.db.insert(activity).values({
            tenantId: tenantA,
            listId: clientesId,
            recordId: clienteRecId,
            userId: anaId,
            action: 'record_updated',
            diff: { [`f${nombreFieldId}`]: { from: 'viejo', to: 'Cliente Uno' } },
        });

        await pg.db.insert(automations).values({
            tenantId: tenantA,
            listId: clientesId,
            name: 'Facturar',
            triggerType: 'record_updated',
            triggerConfig: { changed_fields: ['nombre'] } as never,
            actions: [
                {
                    type: 'create_record',
                    config: { target_list_id: facturasId, values: { estado: 'pendiente' } },
                },
                {
                    type: 'if_else',
                    config: {
                        then_actions: [
                            { type: 'call_webhook', config: { connection_id: connectionId, url: 'https://x.test' } },
                        ],
                        else_actions: [],
                    },
                },
            ] as never,
        });
        hookToken = 'token-viejo-del-origen';
        const [hookAuto] = await pg.db
            .insert(automations)
            .values({
                tenantId: tenantA,
                listId: facturasId,
                name: 'Entrante',
                triggerType: 'incoming_webhook',
                triggerConfig: { webhook_token: hookToken } as never,
                actions: [] as never,
            })
            .returning();
        await pg.db
            .insert(automationHooks)
            .values({ token: hookToken, tenantId: tenantA, automationId: hookAuto!.id });

        await pg.db.insert(dashboards).values({
            tenantId: tenantA,
            name: 'Comercial',
            createdBy: anaId,
            widgets: [
                { type: 'kpi', list_id: facturasId, metric_field_id: estadoFieldId },
                // Widget de contenido: `list_id: 0` significa "sin lista".
                { type: 'heading', list_id: 0, config: { text: 'Resumen' } },
            ],
        });
        await pg.db.insert(recurrences).values({
            tenantId: tenantA,
            listId: clientesId,
            recordId: clienteRecId,
            dateFieldId: nombreFieldId,
            frequency: 'monthly',
        });
        await pg.db.insert(portalLinks).values({
            tenantId: tenantA,
            userId: carlosId,
            listId: clientesId,
            recordId: clienteRecId,
        });
        publicToken = 'publico-del-origen';
        await pg.db
            .insert(publicLists)
            .values({ token: publicToken, tenantId: tenantA, listId: clientesId });
        await pg.db.insert(auditLog).values({
            tenantId: tenantA,
            userId: anaId,
            action: 'list.create',
            targetType: 'list',
            targetId: clientesId,
            targetLabel: 'Clientes',
        });
        await pg.db.insert(emailUsage).values({ tenantId: tenantA, period: '2026-09', sent: 7 });

        // `lists.settings` con las tres formas propias: id por convención,
        // ids como CLAVE y el token público.
        await pg.db
            .update(lists)
            .set({
                settings: {
                    title_field_id: nombreFieldId,
                    permissions: {
                        agent: { view: 'own' },
                        users: { [String(carlosId)]: { view: 'all' } },
                    },
                    portal: { enabled: true, related_lists: [facturasId] },
                    public: {
                        enabled: true,
                        token: publicToken,
                        visible_field_slugs: ['nombre'],
                        view_id: viewId,
                    },
                },
            })
            .where(eq(lists.id, clientesId));
    }, 180_000);

    afterAll(async () => {
        await pg?.stop();
        rmSync(work, { recursive: true, force: true });
        rmSync(uploads, { recursive: true, force: true });
    });

    it('exporta un archivo con manifest, cuentas y bytes', async () => {
        const out = await svc.exportTenant(tenantA, { include_runs: true, include_files: true });
        expect(out.file).toMatch(/^imagina-tenant-acme-.*\.tar$/);
        expect(out.size).toBeGreaterThan(0);
        expect(out.manifest.tenant.slug).toBe('acme');
        expect(out.manifest.counts.records).toBe(3);
        expect(out.manifest.counts.fields).toBe(5);
        expect(out.manifest.files.count).toBe(1);
        expect(out.manifest.secrets_fingerprint).not.toBeNull();

        const status = await svc.status();
        expect(status.available).toBe(true);
        expect(status.files.map((f) => f.name)).toContain(out.file);
        // El manifest se lee del tar, no de un índice aparte.
        expect(status.files.find((f) => f.name === out.file)?.manifest?.tenant.name).toBe('ACME');
    });

    it('importa con TODAS las referencias re-mapeadas a los ids nuevos', async () => {
        const status = await svc.status();
        const file = status.files[0]!.name;

        // Carlos se borra ANTES de importar: así se ejercitan las dos ramas
        // de usuarios — Ana ya existe (se vincula) y Carlos no (se crea).
        await pg.db.delete(users).where(eq(users.id, carlosId));

        const res = await svc.importTenant({ file, name: 'ACME (migrada)' });
        tenantB = res.tenant_id;
        expect(tenantB).not.toBe(tenantA);
        expect(res.slug).toBe('acme-2');
        expect(res.users_linked).toBe(1);
        expect(res.users_created).toBe(1);
        expect(res.counts.records).toBe(3);

        // ── Listas y campos ────────────────────────────────────────────
        const newLists = await pg.db.select().from(lists).where(eq(lists.tenantId, tenantB));
        expect(newLists).toHaveLength(2);
        const newClientes = newLists.find((l) => l.slug === 'clientes')!;
        const newFacturas = newLists.find((l) => l.slug === 'facturas')!;
        expect(newClientes.id).not.toBe(clientesId);
        // La carpeta viajó y la lista quedó dentro de la NUEVA.
        const newGroups = await pg.db.select().from(listGroups).where(eq(listGroups.tenantId, tenantB));
        expect(newGroups).toHaveLength(1);
        expect(newClientes.groupId).toBe(newGroups[0]!.id);

        const newFields = await pg.db.select().from(fields).where(eq(fields.tenantId, tenantB));
        expect(newFields).toHaveLength(5);
        const bySlug = new Map(newFields.map((f) => [f.slug, f]));
        const newNombre = bySlug.get('nombre')!;
        const newEstado = bySlug.get('estado')!;
        // La config de la relación apunta a la lista NUEVA.
        expect(bySlug.get('cliente')!.config).toEqual({ target_list_id: newClientes.id });

        // ── Registros ──────────────────────────────────────────────────
        const newRecords = await pg.db.select().from(records).where(eq(records.tenantId, tenantB));
        expect(newRecords).toHaveLength(3);
        const newCliente = newRecords.find((r) => r.data[`f${newNombre.id}`] === 'Cliente Uno')!;
        const newSub = newRecords.find((r) => r.data[`f${newNombre.id}`] === 'Subtarea')!;
        const newFactura = newRecords.find((r) => r.listId === newFacturas.id)!;
        // Claves f{id} traducidas y valores de `user`/`file` re-apuntados.
        const newAttachments = await pg.db
            .select()
            .from(attachments)
            .where(eq(attachments.tenantId, tenantB));
        expect(newAttachments).toHaveLength(1);
        expect(newAttachments[0]!.id).not.toBe(attachmentId);
        expect(newCliente.data[`f${bySlug.get('dueno')!.id}`]).toBe(anaId); // Ana se vinculó
        expect(newCliente.data[`f${bySlug.get('adjunto')!.id}`]).toEqual([newAttachments[0]!.id]);
        expect(newCliente.data[`f${nombreFieldId}`]).toBeUndefined();
        // Subtarea: el padre es el registro NUEVO.
        expect(newSub.parentId).toBe(newCliente.id);
        expect(newSub.parentId).not.toBe(subtareaRecId);

        // Los bytes del adjunto existen bajo una clave nueva del tenant nuevo.
        expect(newAttachments[0]!.storageKey.startsWith(`t${tenantB}/`)).toBe(true);
        const chunks: Buffer[] = [];
        for await (const c of storage.read(newAttachments[0]!.storageKey)) chunks.push(c as Buffer);
        expect(Buffer.concat(chunks).toString()).toBe('contenido del adjunto');

        // Descripción rica: las tres referencias apuntan a lo nuevo.
        const doc = newFactura.description as unknown as {
            content: Array<{ content?: Array<{ attrs: Record<string, unknown> }>; attrs?: Record<string, unknown> }>;
        };
        expect(doc.content[0]!.content![0]!.attrs.id).toBe(anaId);
        expect(doc.content[0]!.content![1]!.attrs.id).toBe(newCliente.id);
        expect(doc.content[1]!.attrs!.fileId).toBe(newAttachments[0]!.id);

        // ── Relaciones ─────────────────────────────────────────────────
        const newRelations = await pg.db.select().from(relations).where(eq(relations.tenantId, tenantB));
        expect(newRelations).toHaveLength(1);
        expect(newRelations[0]!.sourceRecordId).toBe(newFactura.id);
        expect(newRelations[0]!.targetRecordId).toBe(newCliente.id);
        expect(newRelations[0]!.fieldId).toBe(bySlug.get('cliente')!.id);

        // ── Vistas, comentarios, menciones, actividad ──────────────────
        const newViews = await pg.db.select().from(savedViews).where(eq(savedViews.tenantId, tenantB));
        expect(newViews[0]!.config).toEqual({ group_by_field_id: newEstado.id });
        const newComments = await pg.db.select().from(comments).where(eq(comments.tenantId, tenantB));
        expect(newComments).toHaveLength(2);
        const raiz = newComments.find((c) => c.parentId === null)!;
        const hijo = newComments.find((c) => c.parentId !== null)!;
        expect(hijo.parentId).toBe(raiz.id);
        expect(hijo.recordId).toBe(newCliente.id);
        const newMentions = await pg.db.select().from(mentions).where(eq(mentions.tenantId, tenantB));
        expect(newMentions[0]!.commentId).toBe(raiz.id);
        expect(newMentions[0]!.authorUserId).toBe(anaId);
        // Carlos se creó de nuevo: la mención apunta a la cuenta NUEVA.
        expect(newMentions[0]!.mentionedUserId).not.toBe(carlosId);
        const newActivity = await pg.db.select().from(activity).where(eq(activity.tenantId, tenantB));
        // El diff traduce la CLAVE del campo sin tocar el `{from,to}`.
        expect(newActivity[0]!.diff).toEqual({
            [`f${newNombre.id}`]: { from: 'viejo', to: 'Cliente Uno' },
        });

        // ── Automatizaciones ───────────────────────────────────────────
        const newAutos = await pg.db.select().from(automations).where(eq(automations.tenantId, tenantB));
        expect(newAutos).toHaveLength(2);
        const facturar = newAutos.find((a) => a.name === 'Facturar')!;
        const acciones = facturar.actions as unknown as Array<{ type: string; config: Record<string, unknown> }>;
        expect(acciones[0]!.config.target_list_id).toBe(newFacturas.id);
        // Los merge tags y los valores por slug no se tocan.
        expect(acciones[0]!.config.values).toEqual({ estado: 'pendiente' });
        const rama = (acciones[1]!.config.then_actions as Array<{ config: Record<string, unknown> }>)[0]!;
        const newConnections = await pg.db
            .select()
            .from(connections)
            .where(eq(connections.tenantId, tenantB));
        expect(rama.config.connection_id).toBe(newConnections[0]!.id);
        // El secreto viajó porque la clave de cifrado es la misma.
        expect(newConnections[0]!.secrets).toEqual({ credential: 'enc:v1:loquesea' });

        // El webhook entrante estrena URL: la vieja es del servidor de origen.
        const entrante = newAutos.find((a) => a.name === 'Entrante')!;
        const newToken = (entrante.triggerConfig as unknown as { webhook_token?: string }).webhook_token;
        expect(newToken).toBeTruthy();
        expect(newToken).not.toBe(hookToken);
        const hooks = await pg.db
            .select()
            .from(automationHooks)
            .where(eq(automationHooks.tenantId, tenantB));
        expect(hooks).toEqual([expect.objectContaining({ token: newToken, automationId: entrante.id })]);

        // ── Tableros, recurrencias, portal, enlace público ─────────────
        const newDashboards = await pg.db
            .select()
            .from(dashboards)
            .where(eq(dashboards.tenantId, tenantB));
        const widgets = newDashboards[0]!.widgets as Array<Record<string, unknown>>;
        expect(widgets[0]!.list_id).toBe(newFacturas.id);
        expect(widgets[0]!.metric_field_id).toBe(newEstado.id);
        // `list_id: 0` del widget de contenido se conserva.
        expect(widgets[1]!.list_id).toBe(0);

        const newRec = await pg.db.select().from(recurrences).where(eq(recurrences.tenantId, tenantB));
        expect(newRec[0]!.recordId).toBe(newCliente.id);
        expect(newRec[0]!.dateFieldId).toBe(newNombre.id);

        const newPortal = await pg.db.select().from(portalLinks).where(eq(portalLinks.tenantId, tenantB));
        expect(newPortal[0]!.recordId).toBe(newCliente.id);
        expect(newPortal[0]!.userId).toBe(newMentions[0]!.mentionedUserId);

        const newPublic = await pg.db.select().from(publicLists).where(eq(publicLists.tenantId, tenantB));
        expect(newPublic[0]!.listId).toBe(newClientes.id);
        expect(newPublic[0]!.token).not.toBe(publicToken);

        // ── `lists.settings`, lo último en escribirse ──────────────────
        const settings = newClientes.settings as Record<string, unknown>;
        expect(settings.title_field_id).toBe(newNombre.id);
        const permissions = settings.permissions as Record<string, unknown>;
        // Las CLAVES de permissions.users son ids de usuario.
        expect(Object.keys(permissions.users as object)).toEqual([
            String(newMentions[0]!.mentionedUserId),
        ]);
        expect((settings.portal as Record<string, unknown>).related_lists).toEqual([newFacturas.id]);
        const pub = settings.public as Record<string, unknown>;
        expect(pub.token).toBe(newPublic[0]!.token);
        expect(pub.view_id).toBe(newViews[0]!.id);
        expect(pub.visible_field_slugs).toEqual(['nombre']);

        // ── Bitácora y uso ─────────────────────────────────────────────
        const newAudit = await pg.db.select().from(auditLog).where(eq(auditLog.tenantId, tenantB));
        expect(newAudit[0]!.targetId).toBe(newClientes.id);
        expect(newAudit[0]!.targetLabel).toBe('Clientes');
        const newUsage = await pg.db.select().from(emailUsage).where(eq(emailUsage.tenantId, tenantB));
        expect(newUsage[0]!.sent).toBe(7);

        // El dominio propio no viaja y el enlace público cambió: ambos avisan.
        expect(res.warnings.some((w) => w.includes('lista(s) pública(s)'))).toBe(true);
    }, 120_000);

    it('la empresa original queda intacta', async () => {
        const original = await pg.db.select().from(records).where(eq(records.tenantId, tenantA));
        expect(original).toHaveLength(3);
        const [list] = await pg.db.select().from(lists).where(eq(lists.id, clientesId));
        expect((list!.settings as Record<string, unknown>).title_field_id).toBe(nombreFieldId);
    });

    it('descarta los secretos si el servidor destino tiene otra clave', async () => {
        const otra = new TenantTransferService(
            pg.db,
            loadEnv({ SECRETS_KEY: 'otra-clave-completamente-distinta', TRANSFERS_DIR: work }),
            storage,
        );
        const status = await svc.status();
        const res = await otra.importTenant({ file: status.files[0]!.name, slug: 'acme-otraclave' });
        const conns = await pg.db
            .select()
            .from(connections)
            .where(eq(connections.tenantId, res.tenant_id));
        expect(conns[0]!.secrets).toEqual({});
        expect(res.warnings.some((w) => w.includes('clave de cifrado'))).toBe(true);
    }, 120_000);

    it('rechaza nombres con traversal y archivos que no son exportaciones', async () => {
        expect(() => svc.resolve('../../etc/passwd')).toThrow();
        expect(() => svc.resolve('no-existe.tar')).toThrow();
        await svc.receive('basura.tar', Readable.from(['no soy un tar']));
        await expect(svc.importTenant({ file: 'basura.tar' })).rejects.toThrow();
    });
});
