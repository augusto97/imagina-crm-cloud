import { describe, expect, it } from 'vitest';

import {
    dashboardSubscriptionInputSchema,
    describeSubscription,
    embedDomainSchema,
    subscriptionCron,
    SUBSCRIPTION_LAST_DAY,
} from '../schemas/dashboard-sharing';
import { buildWidgetReport, type ReportContext, type ReportField } from './report';
import { renderDashboardEmail, tintHex } from './report-email';

const fields: ReportField[] = [
    {
        id: 1,
        type: 'select',
        label: 'Estado',
        config: { options: [{ value: 'pendiente', label: 'Pendiente <b>', color: 'amber' }, { value: 'hecho', label: 'Hecho', color: 'green' }] },
    },
    { id: 3, type: 'currency', label: 'Monto', config: { currency: 'COP', precision: 0 } },
];

const ctx: ReportContext = {
    field: (id) => fields.find((f) => f.id === Number(id)),
    userName: () => null,
    format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' },
    listName: () => 'Ventas',
};

describe('v0.1.292 — envío programado del tablero', () => {
    it('horario como cron: domingo = 0, último día = L, días sin repetir y ordenados', () => {
        expect(subscriptionCron({ frequency: 'daily', weekdays: [], month_day: 1, hour: 7, minute: 30 })).toBe('30 7 * * *');
        expect(subscriptionCron({ frequency: 'weekly', weekdays: [4, 1, 7, 1], month_day: 1, hour: 8, minute: 0 })).toBe('0 8 * * 0,1,4');
        expect(subscriptionCron({ frequency: 'monthly', weekdays: [], month_day: SUBSCRIPTION_LAST_DAY, hour: 9, minute: 5 })).toBe('5 9 L * *');
        expect(subscriptionCron({ frequency: 'monthly', weekdays: [], month_day: 15, hour: 9, minute: 5 })).toBe('5 9 15 * *');
    });

    it('horario para personas', () => {
        expect(describeSubscription({ frequency: 'weekly', weekdays: [1, 4], month_day: 1, hour: 8, minute: 0 })).toBe('Cada lunes y jueves a las 08:00');
        expect(describeSubscription({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], month_day: 1, hour: 7, minute: 30 })).toBe('De lunes a viernes a las 07:30');
        expect(describeSubscription({ frequency: 'monthly', weekdays: [], month_day: -1, hour: 18, minute: 0 })).toBe('El último día de cada mes a las 18:00');
        expect(describeSubscription({ frequency: 'daily', weekdays: [], month_day: 1, hour: 6, minute: 0 })).toBe('Todos los días a las 06:00');
    });

    it('destinatarios: al menos uno, máximo 25 entre personas y correos, días en semanal', () => {
        expect(dashboardSubscriptionInputSchema.safeParse({ recipient_user_ids: [] }).success).toBe(false);
        expect(dashboardSubscriptionInputSchema.safeParse({ recipient_emails: ['Socio@Externo.test'] }).data?.recipient_emails).toEqual(['socio@externo.test']);
        const many = Array.from({ length: 20 }, (_, i) => `p${i}@x.test`);
        expect(dashboardSubscriptionInputSchema.safeParse({ recipient_user_ids: [1, 2, 3, 4, 5, 6], recipient_emails: many }).success).toBe(false);
        expect(dashboardSubscriptionInputSchema.safeParse({ recipient_user_ids: [1], frequency: 'weekly', weekdays: [] }).success).toBe(false);
        expect(dashboardSubscriptionInputSchema.safeParse({ recipient_user_ids: [1], time_zone: 'Marte/Olympus' }).success).toBe(false);
        expect(dashboardSubscriptionInputSchema.safeParse({ recipient_user_ids: [1], month_day: 0 }).success).toBe(false);
    });

    it('dominios para insertar el tablero', () => {
        for (const ok of ['ejemplo.com', '*.ejemplo.com', 'sub.ejemplo.com.co', 'localhost:5299', 'https://ejemplo.com', 'http://intranet.ejemplo.com:8080']) {
            expect(embedDomainSchema.safeParse(ok).success, ok).toBe(true);
        }
        for (const bad of ['', 'ejemplo', 'javascript:alert(1)', 'ejemplo.com/ruta', "ejemplo.com; script-src *", '*']) {
            expect(embedDomainSchema.safeParse(bad).success, bad).toBe(false);
        }
    });

    it('el correo escapa lo que escribe la gente y neutraliza las variables', () => {
        const kpi = buildWidgetReport({ type: 'kpi', title: 'Total {{secreto}}', list_id: 1, config: { metric: 'sum', metric_field_id: 3 } }, { value: 1250000 }, ctx);
        const bars = buildWidgetReport(
            { type: 'chart_bar', title: 'Por estado', list_id: 1, config: { group_by_field_id: 1 } },
            { data: [{ label: 'pendiente', value: 3 }, { label: 'hecho', value: 1 }] },
            ctx,
        );
        const { html, text } = renderDashboardEmail({
            dashboardName: 'Ventas <script>',
            companyName: 'Acme',
            reports: [kpi!, bars!],
            accent: '#0e7490',
            dateText: '22/10/2026 08:00',
            message: 'Hola {{equipo}} <img src=x onerror=alert(1)>',
            subject: 'Resumen',
            dashboardUrl: 'https://app.ejemplo.com/#/dashboards/1',
            publicUrl: 'https://app.ejemplo.com/api/v1/public/d/abc',
            senderName: 'Ana',
            withPdf: true,
        });
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('{{secreto}}');
        expect(html).not.toContain('Pendiente <b>');
        expect(html).toContain('$1.250.000');
        expect(html).toContain('bgcolor=');
        expect(html).toContain('https://app.ejemplo.com/#/dashboards/1');
        expect(html).toContain('https://app.ejemplo.com/api/v1/public/d/abc');
        expect(text).toContain('$1.250.000');
        expect(text).toContain('Ver el tablero');
    });

    it('los colores del correo se mezclan con blanco (Outlook no entiende transparencias)', () => {
        expect(tintHex('#000000', 0.5)).toBe('#808080');
        expect(tintHex('#0e7490', 1)).toBe('#0e7490');
        expect(tintHex('no-es-color', 0.5)).toBe('#eef0f3');
    });
});
