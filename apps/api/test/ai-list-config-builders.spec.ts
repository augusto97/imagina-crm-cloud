import type { Field } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { buildCrmCustomConfig, buildPortalTemplate, describePortalTemplate, textToHtml, type PortalBuildContext } from '../src/ai/tools/list-config';
import { AiToolError } from '../src/ai/tools/registry';

/**
 * v0.1.195 — constructores PUROS de la configuración de lista que propone
 * el asistente/MCP. Sin DB: reciben catálogos de campos y devuelven el
 * shape que persisten los editores visuales.
 */

let nextId = 1;
function field(slug: string, type: Field['type'], extra: Partial<Field> = {}): Field {
    return {
        id: nextId++,
        list_id: 1,
        slug,
        label: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, ' '),
        type,
        config: {},
        is_required: false,
        is_unique: false,
        is_indexed: false,
        position: 0,
        description: null,
        created_at: '2026-01-01T00:00:00.000Z',
        ...extra,
    } as Field;
}

const clientes = [field('nombre', 'text'), field('email', 'email'), field('telefono', 'phone'), field('estado', 'select'), field('contrato', 'file'), field('deuda', 'rollup')];
const facturas = [field('numero', 'text'), field('monto', 'currency'), field('estado', 'select'), field('cliente', 'relation')];

function ctx(): PortalBuildContext {
    return {
        fields: new Map(clientes.map((f) => [f.slug, f])),
        related: new Map([['facturas', { id: 2, name: 'Facturas', fields: new Map(facturas.map((f) => [f.slug, f])) }]]),
        listSlug: 'clientes',
    };
}

describe('buildPortalTemplate', () => {
    it('arma la plantilla con el config exacto de cada bloque y apila en el grid', () => {
        const { template, preview } = buildPortalTemplate(
            [
                { type: 'hero', title: 'Hola, {{nombre}}', subtitle: 'Tu portal' },
                { type: 'kpi_widget', title: 'Facturas', list: 'facturas' },
                { type: 'kpi_widget', title: 'Total', list: 'facturas', metric: 'sum', field: 'monto', prefix: '$' },
                { type: 'client_data', title: 'Tus datos', fields: ['nombre', 'email'] },
                { type: 'editable_form', fields: ['telefono'] },
                { type: 'related_records_table', list: 'facturas', fields: ['numero', 'monto'] },
                { type: 'static_text', title: 'Cómo pagar', text: 'Transferí al CBU.\n\nMandá el comprobante.' },
                { type: 'download_files', field: 'contrato' },
            ],
            ctx(),
            'Clientes',
        );
        expect(template.blocks).toHaveLength(8);
        const [hero, kpi1, kpi2, data, form, table, text, files] = template.blocks;
        // Portada a lo ancho, los dos KPIs (w=4) en la MISMA fila siguiente.
        expect([hero!.x, hero!.y, hero!.w]).toEqual([0, 0, 12]);
        expect([kpi1!.x, kpi1!.y, kpi1!.w]).toEqual([0, 6, 4]);
        expect([kpi2!.x, kpi2!.y, kpi2!.w]).toEqual([4, 6, 4]);
        expect(data!.y).toBeGreaterThan(kpi2!.y);
        expect(data!.x).toBe(0);
        // Configs con las claves que lee el portal público.
        expect(hero!.config).toMatchObject({ title: 'Hola, {{nombre}}', subtitle: 'Tu portal', variant: 'gradient' });
        expect(kpi1!.config).toMatchObject({ list_slug: 'facturas', metric: 'count', field_id: 0 });
        expect(kpi2!.config).toMatchObject({ list_slug: 'facturas', metric: 'sum', field_id: facturas[1]!.id, prefix: '$' });
        expect(data!.config).toMatchObject({ visible_field_slugs: ['nombre', 'email'], title: 'Tus datos' });
        expect(form!.config).toMatchObject({ editable_field_slugs: ['telefono'], submit_label: 'Guardar' });
        expect(table!.config).toMatchObject({ list_slug: 'facturas', visible_field_slugs: ['numero', 'monto'], per_page: 10 });
        expect(text!.config).toMatchObject({ html: '<p>Transferí al CBU.</p><p>Mandá el comprobante.</p>' });
        expect(files!.config).toMatchObject({ field_slug: 'contrato' });
        expect(template.blocks.every((b) => typeof b.id === 'string' && b.id.length > 3)).toBe(true);
        expect(preview.map((p) => p.type)).toEqual(['Portada', 'Indicador', 'Indicador', 'Datos del cliente', 'Formulario editable', 'Tabla de registros', 'Texto', 'Descargas']);
        expect(preview[3]!.detail).toBe('Nombre, Email');
        // El resumen de lectura habla en slugs.
        expect(describePortalTemplate(template)[5]).toEqual({ type: 'related_records_table', summary: 'facturas: numero, monto' });
    });

    it('rechaza con mensaje corregible: slug inexistente, lista no vinculada, campo no editable, métrica sin campo, enlace raro', () => {
        expect(() => buildPortalTemplate([{ type: 'client_data', fields: ['dni'] }], ctx(), 'Clientes')).toThrow(/«dni» no existe en «Clientes»/);
        expect(() => buildPortalTemplate([{ type: 'related_records_table', list: 'tickets' }], ctx(), 'Clientes')).toThrow(/no está vinculada.*Vinculadas: facturas/);
        expect(() => buildPortalTemplate([{ type: 'editable_form', fields: ['deuda'] }], ctx(), 'Clientes')).toThrow(/rollup y no se puede editar/);
        expect(() => buildPortalTemplate([{ type: 'kpi_widget', title: 'x', list: 'facturas', metric: 'sum' }], ctx(), 'Clientes')).toThrow(/necesita field/);
        expect(() => buildPortalTemplate([{ type: 'kpi_widget', title: 'x', list: 'facturas', metric: 'sum', field: 'numero' }], ctx(), 'Clientes')).toThrow(/campos numéricos/);
        expect(() => buildPortalTemplate([{ type: 'download_files', field: 'email' }], ctx(), 'Clientes')).toThrow(/campo file/);
        expect(() => buildPortalTemplate([{ type: 'external_link', title: 'x', href: 'javascript:alert(1)' }], ctx(), 'Clientes')).toThrow(AiToolError);
        expect(() => buildPortalTemplate([], ctx(), 'Clientes')).toThrow(/al menos un bloque/);
    });

    it('textToHtml escapa HTML y separa párrafos', () => {
        expect(textToHtml('a <b>\nb\n\nc')).toBe('<p>a &lt;b&gt;<br>b</p><p>c</p>');
    });
});

describe('buildCrmCustomConfig', () => {
    it('genera un V2 con header, grupos en la columna principal y lateral con cifras/vinculados/comentarios/actividad', () => {
        const fields = [...clientes, field('empresa', 'text'), field('notas', 'long_text')];
        const { config, preview, warnings } = buildCrmCustomConfig(
            {
                header: { variant: 'compact', subtitle_fields: ['empresa'], status_fields: ['estado'], quick_action_fields: ['email', 'telefono'] },
                groups: [
                    { label: 'Contacto', fields: ['email', 'telefono'] },
                    { label: 'Dinero', fields: ['deuda'], icon: 'dollar', collapsed: true },
                ],
                sidebar: { related_fields: [], file_fields: ['contrato'] },
                notes: [{ title: 'Cómo atender', text: 'Siempre por WhatsApp.' }],
            },
            fields,
            'nombre',
        );
        expect(warnings).toEqual([]);
        expect(config.v).toBe(2);
        expect(config.header).toEqual({ title_field_slug: 'nombre', subtitle_field_slugs: ['empresa'], status_field_slugs: ['estado'], quick_action_field_slugs: ['email', 'telefono'] });
        const types = config.blocks.map((b) => b.type);
        expect(types).toEqual(['header', 'properties_group', 'properties_group', 'properties_group', 'notes', 'stats', 'files', 'comments_thread', 'timeline']);
        const [header, g1, g2, otros] = config.blocks;
        expect([header!.x, header!.y, header!.w, header!.h]).toEqual([0, 0, 12, 4]);
        expect(header!.config).toMatchObject({ variant: 'compact', show_avatar: true });
        expect(g1!.config).toMatchObject({ label: 'Contacto', icon_key: 'mail', field_slugs: ['email', 'telefono'], collapsed_by_default: false });
        expect(g2!.config).toMatchObject({ label: 'Dinero', icon_key: 'dollar', collapsed_by_default: true });
        // Los que no se asignaron (y no están en el header) van a "Otros datos": nombre (título) y estado/empresa/email/teléfono (header) quedan fuera.
        expect(otros!.config).toMatchObject({ label: 'Otros datos', field_slugs: ['notas'] });
        // Columna principal a la izquierda (w=8), lateral a la derecha (x=8, w=4).
        expect(config.blocks.filter((b) => ['properties_group', 'notes'].includes(b.type)).every((b) => b.x === 0 && b.w === 8)).toBe(true);
        expect(config.blocks.filter((b) => ['stats', 'files', 'comments_thread', 'timeline'].includes(b.type)).every((b) => b.x === 8 && b.w === 4)).toBe(true);
        // Nada se solapa dentro de una columna.
        for (const col of [0, 8]) {
            const inCol = config.blocks.filter((b) => b.x === col && b.type !== 'header').sort((a, b) => a.y - b.y);
            for (let i = 1; i < inCol.length; i++) expect(inCol[i]!.y).toBeGreaterThanOrEqual(inCol[i - 1]!.y + inCol[i - 1]!.h);
        }
        expect(preview.map((p) => p.type)).toContain('Cifras');
    });

    it('adivina el icono por el nombre del grupo, avisa de campos repetidos y respeta include_remaining_fields=false', () => {
        const { config, warnings } = buildCrmCustomConfig(
            { groups: [{ label: 'Datos de contacto', fields: ['email'] }, { label: 'Fechas clave', fields: ['email'] }], include_remaining_fields: false, sidebar: { stats: false, comments: false, timeline: false } },
            clientes,
            'nombre',
        );
        expect(config.blocks.map((b) => b.type)).toEqual(['header', 'properties_group']);
        expect((config.blocks[1]!.config as { icon_key: string }).icon_key).toBe('mail');
        expect(warnings.some((w) => w.includes('estaba en dos grupos'))).toBe(true);
        expect(warnings.some((w) => w.includes('Quedan fuera de la ficha'))).toBe(true);
    });

    it('rechaza campos inexistentes o del tipo equivocado', () => {
        expect(() => buildCrmCustomConfig({ groups: [{ label: 'x', fields: ['nope'] }] }, clientes, null)).toThrow(/«nope» no existe/);
        expect(() => buildCrmCustomConfig({ header: { status_fields: ['nombre'] }, groups: [{ label: 'x', fields: ['email'] }] }, clientes, null)).toThrow(/se esperaba select/);
        expect(() => buildCrmCustomConfig({ groups: [{ label: 'x', fields: ['email'] }], sidebar: { related_fields: ['email'] } }, clientes, null)).toThrow(/se esperaba relation/);
    });
});
