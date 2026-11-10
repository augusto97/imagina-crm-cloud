import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    acceptsWasApiCalls,
    integrationDef,
    swapAppsCompatible,
    swapConnectionInActions,
    type Connection,
    type ConnectionSwapAutomation,
    type ConnectionSwapPreview,
    type ConnectionSwapResult,
    type ConnectionSwapSource,
    type Role,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ConnectorsService } from '../connectors/connectors.service';
import { automations, lists } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AutomationsService } from './automations.service';

interface AutomationRow {
    id: number;
    name: string;
    isActive: boolean;
    actions: unknown;
    listId: number;
    listSlug: string;
    listName: string;
}

/**
 * v0.1.400 — «Reemplazar en automatizaciones»: pasa a UNA conexión las
 * acciones que usan otra (otra cuenta de la misma app, o WAS ↔ Whats) y las
 * llamadas directas a la API de WAS armadas a mano.
 *
 * La traducción es la función pura de shared (`swapConnectionInActions`): la
 * vista previa y el cambio usan la misma. Cada automatización se guarda por
 * `AutomationsService.update`, así queda una VERSIÓN con nota en su historial
 * (se puede volver atrás), se valida como al guardar desde el editor y se
 * re-sincronizan su horario y su webhook. Las corridas que están esperando
 * siguen: el paso «Esperar» queda en el mismo lugar y al seguir ya usan la
 * conexión nueva.
 */
@Injectable()
export class ConnectionSwapService {
    private readonly logger = new Logger(ConnectionSwapService.name);

    constructor(
        private readonly connectors: ConnectorsService,
        private readonly automationsService: AutomationsService,
        private readonly tenantDb: TenantDb,
        private readonly audit: AuditService,
    ) {}

    async preview(tenantId: number, userId: number, role: Role, targetId: number): Promise<ConnectionSwapPreview> {
        const { target, app, conns, info } = await this.context(tenantId, userId, role, targetId);
        const rows = await this.automationRows(tenantId);
        const sources = new Map<string, ConnectionSwapSource>();
        const notes = new Map<string, Set<string>>();
        for (const row of rows) {
            const { findings } = swapConnectionInActions(row.actions, { id: target.id, app }, info);
            const bySource = new Map<string, ConnectionSwapAutomation>();
            for (const f of findings) {
                let source = sources.get(f.source);
                if (!source) {
                    source = this.describeSource(f.source, conns);
                    sources.set(f.source, source);
                    notes.set(f.source, new Set());
                }
                let auto = bySource.get(f.source);
                if (!auto) {
                    auto = {
                        id: row.id,
                        name: row.name,
                        list_id: row.listId,
                        list_slug: row.listSlug,
                        list_name: row.listName,
                        is_active: row.isActive,
                        actions: 0,
                        skipped: [],
                    };
                    bySource.set(f.source, auto);
                    source.automations.push(auto);
                }
                if (f.ok) {
                    auto.actions += 1;
                    source.actions += 1;
                    for (const n of f.notes) notes.get(f.source)!.add(n);
                } else {
                    auto.skipped.push({ path: f.path, reason: f.reason ?? '' });
                    source.skipped += 1;
                }
            }
        }
        for (const [key, set] of notes) sources.get(key)!.notes = [...set];
        return {
            target: { id: target.id, name: target.name, app, app_name: integrationDef(app)?.name ?? target.name },
            sources: [...sources.values()].sort((a, b) => b.actions - a.actions || a.label.localeCompare(b.label)),
        };
    }

    async apply(tenantId: number, userId: number, role: Role, targetId: number, picked: string[]): Promise<ConnectionSwapResult> {
        const { target, app, info } = await this.context(tenantId, userId, role, targetId);
        const selected = new Set(picked);
        const rows = await this.automationRows(tenantId);
        const result: ConnectionSwapResult = { automations: 0, actions: 0, failed: [] };
        for (const row of rows) {
            const { actions, findings } = swapConnectionInActions(row.actions, { id: target.id, app }, info, selected);
            const moved = findings.filter((f) => f.ok && selected.has(f.source)).length;
            if (moved === 0) continue;
            try {
                await this.automationsService.update(
                    tenantId,
                    String(row.listId),
                    row.id,
                    { actions: actions as never },
                    {
                        actorId: userId,
                        note: `Cambió la conexión de ${moved === 1 ? '1 acción' : `${moved} acciones`} a «${target.name}»`.slice(0, 300),
                    },
                );
                result.automations += 1;
                result.actions += moved;
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                this.logger.warn(`No se pudo cambiar la conexión en la automatización ${row.id}: ${reason}`);
                result.failed.push({ automation_id: row.id, automation_name: row.name, reason });
            }
        }
        if (result.automations > 0) {
            await this.audit.log({
                tenantId,
                userId,
                action: 'connection.swap',
                targetType: 'connection',
                targetId: target.id,
                targetLabel: target.name,
                meta: { sources: [...selected], automations: result.automations, actions: result.actions, failed: result.failed.length },
            });
        }
        return result;
    }

    // ── Piezas ───────────────────────────────────────────────────────────

    /** La conexión destino tiene que verse, ser de la galería y recibir algo. */
    private async context(tenantId: number, userId: number, role: Role, targetId: number) {
        const conns = await this.connectors.list(tenantId, userId, role);
        const target = conns.find((c) => c.id === targetId && c.purpose !== 'agenda');
        const app = target?.integration_key ?? null;
        if (!target || !app || !integrationDef(app) || (!swapAppsCompatible(app, app) && !acceptsWasApiCalls(app))) {
            throw new NotFoundException({ code: 'connection_not_found', message: 'Esa conexión no existe o no se puede usar para reemplazar.' });
        }
        // Las conexiones de «Mi calendario» no son de las automatizaciones.
        const info = new Map(
            conns
                .filter((c) => c.purpose !== 'agenda')
                .map((c) => [c.id, { app: c.integration_key, baseUrl: c.base_url !== '' ? c.base_url : null }] as const),
        );
        return { target, app, conns, info };
    }

    private describeSource(key: string, conns: Connection[]): ConnectionSwapSource {
        const empty = { actions: 0, skipped: 0, automations: [], notes: [] };
        if (key.startsWith('conn:')) {
            const id = Number(key.slice(5));
            const c = conns.find((x) => x.id === id);
            const appName = integrationDef(c?.integration_key)?.name ?? c?.name ?? 'Conexión';
            const custom = c?.custom_name === true;
            return {
                key,
                kind: 'connection',
                label: custom ? (c?.name ?? appName) : [appName, c?.account_label].filter(Boolean).join(' · '),
                detail: custom ? [appName, c?.account_label].filter(Boolean).join(' · ') : null,
                connection_id: id,
                app: c?.integration_key ?? null,
                ...empty,
            };
        }
        // `was:<servidor>|<cuenta>`
        const [host = '', account = ''] = key.slice(4).split('|');
        const accountText = account === '' ? 'sin cuenta escrita' : account.includes('{{') ? 'cuenta según el registro' : `cuenta …${account.slice(-6)}`;
        return {
            key,
            kind: 'was_api',
            label: 'Llamadas directas a la API de WAS',
            detail: `${host} · ${accountText}`,
            connection_id: null,
            app: null,
            ...empty,
        };
    }

    private async automationRows(tenantId: number): Promise<AutomationRow[]> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: automations.id,
                    name: automations.name,
                    isActive: automations.isActive,
                    actions: automations.actions,
                    listId: automations.listId,
                    listSlug: lists.slug,
                    listName: lists.name,
                })
                .from(automations)
                .innerJoin(lists, eq(lists.id, automations.listId))
                .where(eq(automations.tenantId, tenantId))
                .orderBy(automations.id),
        );
    }
}
