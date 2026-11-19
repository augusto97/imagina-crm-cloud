import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { agencyBillingState, agencyPeriodText, readAgencyBilling, readAgencyClientPlan, type AgencyBillingSettings } from '@imagina-base/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, tenants, users } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { escapeHtml } from '../legal/legal-page';
import { MailService } from '../mail/mail.service';
import { registerBillingTick, type ReminderDedupStore } from '../payments/billing-reminders.service';
import { REDIS } from '../redis/redis.module';
import { agencyTimeZone, clientsWithAgencyPlan } from './agency-billing.service';
import { AgencyChargesService } from './agency-charges.service';
import { AgencyDebitService } from './agency-debit.service';

/**
 * v0.1.451 (I3, ADR-S108) — Avisos del cobro de una agencia a sus clientes:
 * - `soon`: vence en los próximos días (los que eligió la agencia) → a los
 *   administradores del cliente, si la agencia lo quiere;
 * - `due`: venció y corre la gracia → a la agencia y al cliente;
 * - `cut`: pasó la gracia, quedó en sólo lectura → a la agencia y al cliente.
 * Una vez por fecha (Redis). Los correos al cliente salen con la marca de su
 * agencia (ADR-S108: nunca la de la plataforma).
 */
export type AgencyReminderKind = 'soon' | 'due' | 'cut';

const DAY = 24 * 60 * 60 * 1000;

export interface AgencyReminderEmailOpts {
    audience: 'agency' | 'client';
    clientName: string;
    agencyName: string;
    planText: string;
    dueAt: Date;
    cutAt: Date;
    timeZone: string;
    link: string;
    /** v0.1.452 — el link para pagar en línea (sólo para el cliente). */
    payUrl?: string | null;
}

/** El correo de un aviso (puro, para las pruebas). */
export function agencyReminderEmail(kind: AgencyReminderKind, o: AgencyReminderEmailOpts): { subject: string; text: string; html: string } {
    const fmt = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: o.timeZone });
    const due = fmt(o.dueAt);
    const cut = fmt(o.cutAt);
    const c = o.clientName;
    const copy: Record<AgencyReminderKind, { agency: { subject: string; lines: string[] }; client: { subject: string; lines: string[] } }> = {
        soon: {
            agency: { subject: `El pago de «${c}» vence el ${due}`, lines: [`El pago de «${c}» (${o.planText}) vence el ${due}.`] },
            client: {
                subject: `Tu pago a ${o.agencyName} vence el ${due}`,
                lines: [
                    `El pago de «${c}» a ${o.agencyName} (${o.planText}) vence el ${due}.`,
                    `Si ya pagaste, ${o.agencyName} lo registra y no tienes que hacer nada más.`,
                ],
            },
        },
        due: {
            agency: {
                subject: `Venció el pago de «${c}»`,
                lines: [
                    `El pago de «${c}» (${o.planText}) venció el ${due}.`,
                    `Si no registras el pago antes del ${cut}, la empresa queda en solo lectura (sus datos se conservan).`,
                ],
            },
            client: {
                subject: `Venció tu pago a ${o.agencyName}`,
                lines: [
                    `El pago de «${c}» a ${o.agencyName} venció el ${due}.`,
                    `Si no se registra el pago antes del ${cut}, la empresa queda en solo lectura: podrán ver y descargar todo, pero no editar. Habla con ${o.agencyName} para ponerte al día.`,
                ],
            },
        },
        cut: {
            agency: {
                subject: `«${c}» quedó en solo lectura`,
                lines: [
                    `«${c}» no tiene registrado el pago que venció el ${due}: quedó en solo lectura.`,
                    'Al registrar el pago vuelve a funcionar al instante, con todo lo que tenía.',
                ],
            },
            client: {
                subject: `«${c}» quedó en solo lectura`,
                lines: [
                    `El pago de «${c}» a ${o.agencyName} venció el ${due} y la empresa quedó en solo lectura.`,
                    `Tus datos están intactos y se pueden ver y descargar. Cuando ${o.agencyName} registre el pago, vuelve a funcionar al instante.`,
                ],
            },
        },
    };
    const m = copy[kind][o.audience];
    const pay = o.audience === 'client' && o.payUrl ? o.payUrl : null;
    // Con el link en línea, el aviso no dice «la agencia lo registra»: se paga ahí mismo.
    const lines = pay
        ? m.lines.map((l) => (l.startsWith('Si ya pagaste') ? `Puedes pagar en línea con el botón de abajo: se registra solo y tu plan queda al día al instante.` : l))
        : m.lines;
    const cta = o.audience === 'agency' ? 'Registrar el pago' : pay ? 'Pagar ahora' : 'Ver mi plan';
    const href = pay ?? o.link;
    const text = `${lines.join('\n\n')}\n\n${cta}: ${href}${pay ? `\n\nVer mi plan: ${o.link}` : ''}`;
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">
${lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${escapeHtml(href)}" style="background:#0e7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${cta}</a></p>${
        pay ? `\n<p style="margin:0;font-size:13px"><a href="${escapeHtml(o.link)}" style="color:#0e7490">Ver mi plan</a></p>` : ''
    }
</div>`;
    return { subject: m.subject, text, html };
}

/** Qué aviso toca para un cliente (o ninguno). `cut` sólo la primera semana después del corte. */
export function agencyReminderKindFor(
    settings: AgencyBillingSettings,
    paidUntil: Date,
    now: Date,
): { kind: AgencyReminderKind; dueAt: Date; cutAt: Date } | null {
    const st = agencyBillingState({ has_plan: true, paid_until: paidUntil, grace_days: settings.grace_days, remind_days: settings.remind_days, now });
    const dueAt = new Date(st.due_at!);
    const cutAt = new Date(st.cut_at!);
    if (st.state === 'due_soon') return { kind: 'soon', dueAt, cutAt };
    if (st.state === 'grace') return { kind: 'due', dueAt, cutAt };
    if (st.state === 'unpaid' && now.getTime() - cutAt.getTime() < 7 * DAY) return { kind: 'cut', dueAt, cutAt };
    return null;
}

@Injectable()
export class AgencyBillingRemindersService implements OnModuleInit {
    private readonly logger = new Logger(AgencyBillingRemindersService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly dedup: ReminderDedupStore,
        @Inject(ENV) private readonly env: Env,
        private readonly mail: MailService,
        @Optional() private readonly domains?: DomainsService,
        @Optional() private readonly charges?: AgencyChargesService,
        @Optional() private readonly debit?: AgencyDebitService,
    ) {}

    onModuleInit(): void {
        // Corre con el reloj de los avisos de cobro de la plataforma (cada hora).
        registerBillingTick((now) => this.tick(now));
    }

    async tick(now = new Date()): Promise<number> {
        const clients = await clientsWithAgencyPlan(this.db);
        if (clients.length === 0) return 0;
        const agencyIds = [...new Set(clients.map((c) => c.agencyId!))];
        const agencies = await this.db
            .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
            .from(tenants)
            .where(and(inArray(tenants.id, agencyIds), isNull(tenants.archivedAt)));
        const byId = new Map(agencies.map((a) => [a.id, a]));
        let sent = 0;
        for (const c of clients) {
            const agency = byId.get(c.agencyId!);
            if (!agency) continue;
            const aSettings = (agency.settings ?? {}) as Record<string, unknown>;
            const settings = readAgencyBilling(aSettings.agency_billing);
            const plan = readAgencyClientPlan((c.settings as Record<string, unknown> | null)?.agency_plan);
            if (!plan || !c.agencyPaidUntil) continue;
            const hit = agencyReminderKindFor(settings, c.agencyPaidUntil, now);
            if (!hit) continue;
            // v0.1.453 — con el débito automático cobrando, el «por vencer» sobra (se paga solo)
            // y los avisos no llevan link (cobraría dos veces).
            const charging = this.debit ? await this.debit.isCharging(agency.id, c.id).catch(() => false) : false;
            if (charging && hit.kind === 'soon') continue;
            const key = `agbill:${c.id}:${hit.kind}:${c.agencyPaidUntil.toISOString()}`;
            const first = await this.dedup.set(key, '1', 'EX', 90 * 24 * 60 * 60, 'NX').catch(() => null);
            if (first !== 'OK') continue;
            const planText = `${plan.name}, ${agencyPeriodText(plan.period_months)}`;
            const tz = agencyTimeZone(aSettings);
            const base = { clientName: c.name, agencyName: agency.name, planText, dueAt: hit.dueAt, cutAt: hit.cutAt, timeZone: tz };
            if (hit.kind !== 'soon') {
                const brand = await this.brand(agency.id);
                sent += await this.send(agency.id, agencyReminderEmail(hit.kind, { ...base, audience: 'agency', link: `${brand.base}/#/agency` }), brand.name);
            }
            if (settings.notify_client) {
                const brand = await this.brand(c.id);
                // v0.1.452 — si la agencia cobra en línea, el aviso trae el link para pagar.
                const payUrl = this.charges && !charging
                    ? await this.charges.autoLink(agency.id, c.id).catch((err: unknown) => {
                          this.logger.warn(`aviso de pago de agencia: no se armó el link de la empresa ${c.id}: ${String(err)}`);
                          return null;
                      })
                    : null;
                sent += await this.send(c.id, agencyReminderEmail(hit.kind, { ...base, audience: 'client', link: `${brand.base}/#/settings?s=suscripcion`, payUrl }), brand.name);
            }
        }
        return sent;
    }

    private async brand(tenantId: number): Promise<{ name: string; base: string }> {
        try {
            if (this.domains) return await this.domains.accountBrand({ tenantId });
        } catch {
            // sin dominio: la dirección de la app
        }
        return { name: '', base: this.env.APP_BASE_URL.replace(/\/+$/, '') };
    }

    /** A los administradores PROPIOS de la empresa (no a quien entra por la agencia). */
    private async send(tenantId: number, msg: { subject: string; text: string; html: string }, fromName: string): Promise<number> {
        const admins = await this.db
            .select({ email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'), eq(memberships.viaAgency, false), isNull(users.disabledAt)));
        let sent = 0;
        for (const a of admins) {
            try {
                await this.mail.enqueue({ to: a.email, ...msg, ...(fromName ? { fromName } : {}) });
                sent++;
            } catch (err) {
                this.logger.warn(`aviso de pago de agencia a ${a.email} (empresa ${tenantId}) no salió: ${String(err)}`);
            }
        }
        return sent;
    }
}
