import { describe, expect, it } from 'vitest';

import { suggestRecordLayoutTemplate, type SuggestLayoutField } from './record-layout-suggest';

const f = (label: string, type: string, config?: Record<string, unknown>): SuggestLayoutField => ({
    label,
    slug: label.toLowerCase().replace(/\s+/g, '_'),
    type,
    config,
});
const opts = (...labels: string[]) => ({ options: labels.map((l) => ({ value: l.toLowerCase(), label: l })) });

describe('suggestRecordLayoutTemplate', () => {
    it('por el nombre: ventas, soporte, personas, trabajo y el resto', () => {
        const cases: Array<[string, string]> = [
            ['Oportunidades', 'deal'],
            ['Pipeline de ventas', 'deal'],
            ['Tickets', 'support'],
            ['Mesa de ayuda / Tickets', 'support'],
            ['Incidencias', 'support'],
            ['Clientes', 'contact'],
            ['Candidatos', 'contact'],
            ['Invitados', 'contact'],
            ['Proveedores', 'contact'],
            ['Contactos por WhatsApp', 'contact'],
            ['CRM de clientes', 'contact'],
            ['Tareas', 'task'],
            ['Proyectos y tareas', 'task'],
            ['Objetivos', 'task'],
            ['Facturas', 'auto'],
            ['Órdenes de compra', 'auto'],
            ['Inventario', 'auto'],
            ['Citas', 'auto'],
            ['Propiedades', 'auto'],
        ];
        for (const [name, kind] of cases) expect(suggestRecordLayoutTemplate({ name, fields: [] }), name).toBe(kind);
    });

    it('la palabra que aparece primero manda', () => {
        expect(suggestRecordLayoutTemplate({ name: 'Facturas de clientes', fields: [] })).toBe('auto');
        expect(suggestRecordLayoutTemplate({ name: 'Clientes con facturas', fields: [] })).toBe('contact');
        expect(suggestRecordLayoutTemplate({ name: 'Tareas de soporte', fields: [] })).toBe('task');
        expect(suggestRecordLayoutTemplate({ name: 'Atención al CLIENTE', fields: [] })).toBe('contact');
    });

    it('sin pistas en el nombre, por los campos', () => {
        expect(suggestRecordLayoutTemplate({ name: 'Mis cosas', fields: [f('Monto', 'currency'), f('Etapa', 'select', opts('Nuevo', 'Ganado'))] })).toBe('deal');
        // Un estado común con un monto (facturas) NO es un negocio.
        expect(
            suggestRecordLayoutTemplate({ name: 'Mis cosas', fields: [f('Monto', 'currency'), f('Estado', 'select', opts('Pendiente', 'Pagada'))] }),
        ).toBe('auto');
        expect(suggestRecordLayoutTemplate({ name: 'Registro', fields: [f('Prioridad', 'select', opts('Alta')), f('Correo', 'email')] })).toBe('support');
        expect(suggestRecordLayoutTemplate({ name: 'X', fields: [f('Fecha de entrega', 'date'), f('Responsable', 'user')] })).toBe('task');
        expect(suggestRecordLayoutTemplate({ name: 'X', fields: [f('Nombre', 'text'), f('Correo', 'email')] })).toBe('contact');
        expect(suggestRecordLayoutTemplate({ name: 'X', fields: [f('Correo', 'email'), f('Celular', 'phone')] })).toBe('contact');
        expect(suggestRecordLayoutTemplate({ name: 'X', fields: [f('Nota', 'text')] })).toBe('auto');
        // «Cuentas» de un CRM son clientes; «Cuentas por cobrar», no.
        expect(suggestRecordLayoutTemplate({ name: 'Cuentas', fields: [f('Nombre', 'text'), f('Email', 'email')] })).toBe('contact');
        expect(suggestRecordLayoutTemplate({ name: 'Cuentas por cobrar', fields: [f('Nombre', 'text'), f('Email', 'email')] })).toBe('auto');
        expect(suggestRecordLayoutTemplate({ name: 'Estado de cuenta', fields: [] })).toBe('auto');
        expect(suggestRecordLayoutTemplate({ name: '', fields: [] })).toBe('auto');
    });
});
