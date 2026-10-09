import type { NotificationKind } from '@imagina-base/shared';
import { escapeHtml } from '../legal/legal-page';

/**
 * v0.1.276 (ADR-S40) — Textos de los avisos y del correo. Puro: se testea sin
 * base ni red. El título se arma AL CREAR el aviso (si después se renombra el
 * registro, el aviso sigue contando lo que pasó).
 */

export interface FieldInfo {
    id: number;
    label: string;
    type: string;
    config?: unknown;
}

const MAX_TITLE = 280;

function quote(title: string): string {
    const t = title.trim() || 'Sin título';
    return `«${t.length > 80 ? `${t.slice(0, 79)}…` : t}»`;
}

function who(actorName: string | null): string {
    return actorName && actorName.trim() ? actorName.trim() : 'Una automatización';
}

export function notificationTitle(
    kind: NotificationKind,
    o: { actorName: string | null; recordTitle: string; source?: 'comment' | 'description' },
): string {
    const rec = quote(o.recordTitle);
    let out: string;
    switch (kind) {
        case 'mention':
            out =
                o.source === 'description'
                    ? `${who(o.actorName)} te mencionó en la descripción de ${rec}`
                    : `${who(o.actorName)} te mencionó en ${rec}`;
            break;
        case 'assigned':
            out = `${who(o.actorName)} te asignó ${rec}`;
            break;
        case 'comment':
            out = `${who(o.actorName)} comentó en ${rec}`;
            break;
        case 'update':
            out = `${who(o.actorName)} cambió ${rec}`;
            break;
        case 'reminder':
            out = `Recordatorio: ${rec}`;
            break;
    }
    return out.length > MAX_TITLE ? `${out.slice(0, MAX_TITLE - 1)}…` : out;
}

function optionLabel(field: FieldInfo, value: unknown): string | null {
    const opts = (field.config as { options?: Array<{ value: string; label?: string }> } | undefined)?.options;
    if (!Array.isArray(opts)) return null;
    const hit = opts.find((o) => o.value === value);
    return hit ? hit.label || hit.value : null;
}

/** Un valor como lo LEE una persona (corto; para el extracto del aviso). */
export function displayValue(field: FieldInfo, value: unknown, userNames: Map<number, string>): string {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return 'vacío';
    switch (field.type) {
        case 'select':
            return optionLabel(field, value) ?? String(value);
        case 'multi_select':
            return Array.isArray(value) ? value.map((v) => optionLabel(field, v) ?? String(v)).join(', ') : String(value);
        case 'checkbox':
            return value === true ? 'Sí' : 'No';
        case 'user':
            return userNames.get(Number(value)) ?? `Usuario #${String(value)}`;
        case 'long_text': {
            const s = String(value).replace(/\s+/g, ' ').trim();
            return s.length > 60 ? `${s.slice(0, 59)}…` : s;
        }
        default: {
            if (typeof value === 'object') return '…';
            const s = String(value);
            return s.length > 60 ? `${s.slice(0, 59)}…` : s;
        }
    }
}

const SHOWN_TYPES = new Set(['select', 'checkbox', 'user', 'date', 'datetime', 'number', 'currency', 'percent', 'rating', 'text', 'email', 'phone']);

/**
 * Qué cambió, en una línea: «Estado: Pendiente → Pagada · Monto». Los tipos
 * cortos muestran antes → después; los largos (textos, documentos) sólo el
 * nombre. Máximo 4 campos.
 */
export function changeSummary(
    fields: readonly FieldInfo[],
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    userNames: Map<number, string>,
): { text: string; fieldIds: number[] } {
    const parts: string[] = [];
    const ids: number[] = [];
    for (const f of fields) {
        const key = `f${f.id}`;
        if (!(key in after) && !(key in before)) continue;
        if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue;
        ids.push(f.id);
        if (parts.length >= 4) continue;
        if (SHOWN_TYPES.has(f.type)) {
            parts.push(`${f.label}: ${displayValue(f, before[key], userNames)} → ${displayValue(f, after[key], userNames)}`);
        } else {
            parts.push(f.label);
        }
    }
    const extra = ids.length - parts.length;
    return { text: parts.join(' · ') + (extra > 0 ? ` · y ${extra} más` : ''), fieldIds: ids };
}

/** Ids de usuario nuevos en los campos persona (para «te asignó»). */
export function newlyAssigned(
    userFieldIds: readonly number[],
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): number[] {
    const out = new Set<number>();
    for (const id of userFieldIds) {
        const key = `f${id}`;
        if (!(key in after)) continue;
        const now = Number(after[key]);
        if (!Number.isInteger(now) || now <= 0) continue;
        if (Number(before[key]) === now) continue;
        out.add(now);
    }
    return [...out];
}

// ─────────────────────────── Correo ───────────────────────────

export interface MailContent {
    subject: string;
    text: string;
    html: string;
}

function shell(company: string, inner: string, footer: string): string {
    return `<div style="background:#f4f5f7;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb">
<tr><td style="padding:22px 24px 6px;font-size:12px;color:#6b7280">${escapeHtml(company)}</td></tr>
<tr><td style="padding:4px 24px 22px;font-size:15px;line-height:1.55;color:#1f2937">${inner}</td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#6b7280;text-align:center">${footer}</p>
</div>`;
}

function button(link: string, label: string): string {
    return `<p style="margin:20px 0 4px"><a href="${escapeHtml(link)}" style="background:#0e7490;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>`;
}

/** Un aviso, en el momento. */
export function notificationEmail(o: {
    company: string;
    title: string;
    body: string;
    link: string;
    settingsLink: string;
}): MailContent {
    const body = o.body.trim();
    const inner = `<p style="margin:0 0 10px;font-size:17px;font-weight:600">${escapeHtml(o.title)}</p>
${body ? `<p style="margin:0;padding:10px 12px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:4px;color:#374151;white-space:pre-wrap">${escapeHtml(body)}</p>` : ''}
${button(o.link, 'Abrir')}`;
    const footer = `Recibes este correo por tus preferencias de avisos. <a href="${escapeHtml(o.settingsLink)}" style="color:#6b7280">Cambiarlas</a>`;
    return {
        subject: o.title,
        text: `${o.title}\n\n${body ? `${body}\n\n` : ''}Abrir: ${o.link}\n\nCambia tus preferencias de avisos: ${o.settingsLink}`,
        html: shell(o.company, inner, footer),
    };
}

export interface DigestItem {
    title: string;
    detail: string;
}

/** El resumen diario. */
export function digestEmail(o: {
    company: string;
    dateLabel: string;
    unread: DigestItem[];
    unreadTotal: number;
    overdue: DigestItem[];
    today: DigestItem[];
    link: string;
    settingsLink: string;
}): MailContent {
    const section = (title: string, items: DigestItem[], more = 0): { html: string; text: string } => {
        if (items.length === 0) return { html: '', text: '' };
        const li = items
            .map(
                (i) =>
                    `<li style="margin:0 0 6px">${escapeHtml(i.title)}${i.detail ? `<br><span style="color:#6b7280;font-size:13px">${escapeHtml(i.detail)}</span>` : ''}</li>`,
            )
            .join('');
        return {
            html: `<p style="margin:18px 0 6px;font-weight:600">${escapeHtml(title)}</p><ul style="margin:0;padding-left:18px">${li}</ul>${more > 0 ? `<p style="margin:6px 0 0;color:#6b7280;font-size:13px">y ${more} más</p>` : ''}`,
            text: `${title}\n${items.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ''}`).join('\n')}${more > 0 ? `\n  y ${more} más` : ''}\n`,
        };
    };
    const a = section('Vencido', o.overdue);
    const b = section('Vence hoy', o.today);
    const c = section('Avisos sin leer', o.unread, Math.max(0, o.unreadTotal - o.unread.length));
    const subject = `Tu resumen de ${o.company} · ${o.dateLabel}`;
    const intro = 'Esto es lo que tienes pendiente hoy.';
    const inner = `<p style="margin:0 0 4px;font-size:17px;font-weight:600">${escapeHtml(`Tu resumen · ${o.dateLabel}`)}</p>
<p style="margin:0;color:#4b5563">${intro}</p>${a.html}${b.html}${c.html}
${button(o.link, 'Ir a Mi trabajo')}`;
    const footer = `Recibes este resumen porque lo activaste. <a href="${escapeHtml(o.settingsLink)}" style="color:#6b7280">Cambiar o apagar</a>`;
    return {
        subject,
        text: `Tu resumen · ${o.dateLabel}\n\n${intro}\n\n${a.text}${b.text}${c.text}\nIr a Mi trabajo: ${o.link}\n\nCambiar o apagar el resumen: ${o.settingsLink}`,
        html: shell(o.company, inner, footer),
    };
}
