import { Injectable } from '@nestjs/common';
import {
    EMAIL_FONT_STACKS,
    emailBodyMode,
    emailSignatureHtml,
    emailSignatureUserId,
    emailThemeSchema,
    formatEmailFieldValue,
    htmlToPlainText,
    parseEmailDesign,
    renderEmailHtml,
    renderEmailText,
    tenantFormatSchema,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { memberships, tenants, users } from '../db/schema';
import type { Tx } from '../db/client';
import type { LabelFieldLike } from './merge-tags';

export interface ComposeInput {
    tenantId: number;
    cfg: Record<string, unknown>;
    /** Variables resueltas, valores CRUDOS. */
    merge: (s: unknown) => string;
    /** Variables resueltas con los VALORES escapados (modo HTML propio). */
    mergeHtml: (s: unknown) => string;
    fieldsBySlug: ReadonlyMap<string, LabelFieldLike>;
    /** Valor crudo de un campo del registro por slug. */
    fieldValue: (slug: string) => unknown;
    timeZone?: string;
}

export interface ComposedEmail {
    subject: string;
    html?: string;
    text?: string;
    /** Por qué no se agregó la firma pedida (para el log del run / la prueba). */
    signatureNote?: string;
}

/**
 * v0.1.265 (ADR-S34) — Arma el correo de la acción `send_email`: asunto +
 * cuerpo en sus tres modos (diseño por bloques, texto, HTML propio) + la
 * firma elegida. Lo usan el MOTOR y el botón «Enviar prueba» del editor, así
 * lo que se prueba es exactamente lo que después sale.
 */
@Injectable()
export class EmailComposer {
    async compose(tx: Tx, input: ComposeInput): Promise<ComposedEmail> {
        const { cfg, merge, mergeHtml } = input;
        const mode = emailBodyMode(cfg);
        const subject = merge(cfg.subject);
        const sig = await this.signature(tx, input.tenantId, emailSignatureUserId(cfg));
        const signatureHtml = sig.html;

        if (mode === 'design') {
            const design = parseEmailDesign(cfg.design);
            if (!design) {
                throw new Error('El diseño del correo no es válido: ábrelo en el editor y vuelve a guardarlo.');
            }
            const format = await this.tenantFormat(tx, input.tenantId);
            const userNames = await this.userNames(tx, input, design.blocks);
            const fieldLabel = (slug: string): string | null => input.fieldsBySlug.get(slug)?.label ?? null;
            const fieldValue = (slug: string): string =>
                formatEmailFieldValue(input.fieldsBySlug.get(slug), input.fieldValue(slug), { ...format, timezone: input.timeZone ?? format.timezone }, (id) =>
                    userNames.get(id) ?? null,
                );
            const opts = {
                resolve: (t: string) => merge(t),
                fieldLabel,
                fieldValue,
                signatureHtml,
                appendSignature: true,
                preheader: typeof cfg.preheader === 'string' ? cfg.preheader : '',
                subject: typeof cfg.subject === 'string' ? cfg.subject : '',
            };
            return {
                subject,
                html: renderEmailHtml(design, opts),
                text: renderEmailText(design, opts),
                signatureNote: sig.note,
            };
        }

        if (mode === 'html') {
            let html = mergeHtml(cfg.body);
            if (signatureHtml) {
                const theme = emailThemeSchema.parse({});
                html += `<br><br>${emailSignatureHtml(signatureHtml, EMAIL_FONT_STACKS.sans, theme)}`;
            }
            return { subject, html, signatureNote: sig.note };
        }

        let text = merge(cfg.body);
        if (signatureHtml) text += `\n\n-- \n${htmlToPlainText(signatureHtml)}`;
        return { subject, text, signatureNote: sig.note };
    }

    /**
     * La firma de la persona elegida. Sólo vale si sigue siendo del EQUIPO de
     * esta empresa (no un cliente del portal, no una cuenta desactivada): la
     * firma de alguien que se fue no debería seguir saliendo en los correos.
     */
    private async signature(
        tx: Tx,
        tenantId: number,
        userId: number | null,
    ): Promise<{ html: string | null; note?: string }> {
        if (userId === null) return { html: null };
        const [row] = await tx
            .select({ signature: users.emailSignature })
            .from(users)
            .innerJoin(memberships, eq(memberships.userId, users.id))
            .where(
                and(
                    eq(users.id, userId),
                    eq(memberships.tenantId, tenantId),
                    ne(memberships.role, 'client'),
                    isNull(users.disabledAt),
                ),
            )
            .limit(1);
        if (!row) return { html: null, note: 'La persona de la firma ya no es del equipo: el correo salió sin firma.' };
        const html = (row.signature ?? '').trim();
        if (!html) return { html: null, note: 'Esa persona todavía no cargó su firma: el correo salió sin firma.' };
        return { html };
    }

    private async tenantFormat(tx: Tx, tenantId: number) {
        const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const raw = (row?.settings as Record<string, unknown> | null | undefined)?.format;
        const parsed = tenantFormatSchema.safeParse(raw ?? {});
        return parsed.success ? parsed.data : tenantFormatSchema.parse({});
    }

    /** Nombres de las personas que aparecen en el bloque «Datos del registro». */
    private async userNames(
        tx: Tx,
        input: ComposeInput,
        blocks: Array<{ type: string; slugs?: string[] }>,
    ): Promise<Map<number, string>> {
        const ids = new Set<number>();
        for (const b of blocks) {
            if (b.type !== 'fields') continue;
            for (const slug of b.slugs ?? []) {
                if (input.fieldsBySlug.get(slug)?.type !== 'user') continue;
                const id = Number(input.fieldValue(slug));
                if (Number.isInteger(id) && id > 0) ids.add(id);
            }
        }
        if (ids.size === 0) return new Map();
        const rows = await tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .innerJoin(memberships, eq(memberships.userId, users.id))
            .where(and(eq(memberships.tenantId, input.tenantId), inArray(users.id, [...ids])));
        return new Map(rows.map((r) => [r.id, r.name]));
    }
}
