import { describe, expect, it } from 'vitest';
import { buildDraftPlan, cleanFieldLabel, fileBaseName, pluralName } from './draft';
import { cleanHeaders, maskSample, profileSheet } from './profile';
import { makeFileImportCellReader, resolveFileImportPlan } from './resolve';
import { fileImportPlanSchema, type FileImportPlan } from './schema';

const CLIENTS = [
    ['Acme S.A.S.', 'compras@acme.co', '+57 300 111 2233', 'Bogotá'],
    ['Delta Ltda', 'pagos@delta.co', '+57 310 222 3344', 'Medellín'],
    ['Orbe SAS', 'admin@orbe.co', '+57 320 333 4455', 'Cali'],
    ['Nimbo', 'hola@nimbo.co', '+57 315 444 5566', 'Bogotá'],
];

/** Una hoja de facturas: los clientes se repiten con sus datos, Total = Subtotal + IVA. */
function invoiceRows(n = 24): string[][] {
    const states = ['Pagada', 'PENDIENTE', 'pendiente', 'Vencida', 'Pagada '];
    const rows: string[][] = [];
    for (let i = 0; i < n; i++) {
        const c = CLIENTS[i % CLIENTS.length]!;
        const sub = 100000 + i * 1000;
        const iva = Math.round(sub * 0.19);
        rows.push([
            `FV-${String(1000 + i)}`,
            c[0]!,
            c[1]!,
            c[2]!,
            c[3]!,
            `${String((i % 27) + 1).padStart(2, '0')}/0${(i % 9) + 1}/2026`,
            String(sub),
            String(iva),
            String(sub + iva),
            states[i % states.length]!,
            '',
            'Colombia',
        ]);
    }
    return rows;
}
const INVOICE_HEADERS = ['Factura N°', 'Cliente', 'Correo', 'Teléfono', 'Ciudad', 'Fecha', 'Subtotal', 'IVA', 'Total', 'ESTADO', '', 'País'];

describe('file-import · perfil', () => {
    it('limpia encabezados vacíos y repetidos', () => {
        expect(cleanHeaders(['Nombre', '', 'Nombre', 'Unnamed: 3'])).toEqual(['Nombre', 'Columna 2', 'Nombre 2', 'Columna 4']);
    });

    it('detecta tipos por datos y encabezado, y propone descartes con su motivo', () => {
        const p = profileSheet(0, 'Facturas', INVOICE_HEADERS, invoiceRows(), { numberFormat: 'dot_comma', dateFormat: 'dmy' });
        const by = (h: string) => p.columns.find((c) => c.header === h)!;
        expect(by('Factura N°').detected).toBe('text');
        expect(by('Correo').detected).toBe('email');
        expect(by('Teléfono').detected).toBe('phone');
        expect(by('Fecha').detected).toBe('date');
        expect(by('Fecha').date_order).toBe('dmy');
        expect(by('Subtotal').detected).toBe('currency');
        expect(by('ESTADO').detected).toBe('select');
        expect(by('Total').discard).toMatch(/suma/);
        expect(by('País').discard).toMatch(/mismo valor/);
        expect(p.columns[10]!.discard).toBeTruthy();
    });

    it('un monto con miles agrupados no es un teléfono (encontrado en la prueba en el navegador)', () => {
        const rows = ['1.000.000', '1.013.500', '1.027.000', '12.500.000', '2.450.000'].map((v) => [v]);
        const valor = profileSheet(0, '', ['Valor'], rows, { numberFormat: 'dot_comma' });
        expect(valor.columns[0]!.detected).toBe('currency');
        const sinPista = profileSheet(0, '', ['Cifra'], rows, { numberFormat: 'dot_comma' });
        expect(sinPista.columns[0]!.detected).toBe('number');
        // Un teléfono de verdad (3-3-4) sigue siendo teléfono.
        const tel = profileSheet(0, '', ['Contacto'], ['300 111 2233', '+57 310 222 3344', '315.333.4455'].map((v) => [v]));
        expect(tel.columns[0]!.detected).toBe('phone');
    });

    it('«Tarea 1» no es un número; «COP 1.500», «$ 2.000» y «3.500 USD» sí (encontrado en la prueba)', () => {
        const nombres = profileSheet(0, '', ['Tarea'], Array.from({ length: 12 }, (_, i) => [`Tarea ${i + 1}`]));
        expect(nombres.columns[0]!.detected).toBe('text');
        const montos = profileSheet(0, '', ['Cifra'], ['COP 1.500', '$ 2.000', '3.500 USD', '(1.200)', '-450'].map((v) => [v]), { numberFormat: 'dot_comma' });
        expect(['number', 'currency']).toContain(montos.columns[0]!.detected);
    });

    it('enmascara datos personales para la IA', () => {
        expect(maskSample('ana@acme.co', 'email')).toBe('[correo]');
        expect(maskSample('+57 300 111 2233', 'phone')).toBe('[teléfono de 12 dígitos]');
        expect(maskSample('900123456', 'id')).toBe('[número de 9 dígitos]');
        expect(maskSample('Llamar a ana@acme.co o al 3001112233 mañana', 'free_text')).not.toMatch(/acme|3001112233/);
    });
});

describe('file-import · borrador', () => {
    it('nombres legibles', () => {
        expect(fileBaseName('clientes_2026.xlsx')).toBe('Clientes 2026');
        expect(cleanFieldLabel('NOMBRE CLIENTE')).toBe('Nombre cliente');
        expect(pluralName('Cliente')).toBe('Clientes');
        expect(pluralName('Proveedor')).toBe('Proveedores');
        expect(pluralName('Nombre del vendedor')).toBe('Vendedores');
        expect(pluralName('Ciudad')).toBe('Ciudades');
    });

    it('una hoja de facturas: título, opciones con color, clientes en su propia lista', () => {
        const rows = invoiceRows();
        const profile = profileSheet(0, 'Hoja1', INVOICE_HEADERS, rows, { numberFormat: 'dot_comma', dateFormat: 'dmy' });
        const plan = buildDraftPlan([{ profile, rows }], { fileName: 'facturacion_octubre.xlsx', currency: 'COP' });
        expect(fileImportPlanSchema.safeParse(plan).success).toBe(true);
        expect(plan.kind).toBe('invoices');
        const list = plan.lists[0]!;
        expect(list.name).toBe('Facturacion octubre');
        expect(profile.headers[list.title_column]).toBe('Factura N°');
        const estado = list.fields.find((f) => f.label === 'Estado')!;
        expect(estado.type).toBe('select');
        expect(estado.options!.map((o) => [o.label, o.color])).toEqual(
            expect.arrayContaining([
                ['Pagada', 'green'],
                ['Vencida', 'red'],
            ]),
        );
        // «PENDIENTE» y «pendiente» son la misma opción.
        expect(estado.options!.filter((o) => /pendiente/i.test(o.label))).toHaveLength(1);
        expect(list.fields.find((f) => f.label === 'Total')!.include).toBe(false);
        const sub = list.fields.find((f) => f.label === 'Subtotal')!;
        expect(sub.currency).toBe('COP');
        expect(sub.precision).toBe(0);

        expect(plan.entities).toHaveLength(1);
        const e = plan.entities[0]!;
        expect(e.name).toBe('Clientes');
        expect(e.include).toBe(true);
        expect(e.records).toBe(4);
        expect(e.columns.map((c) => profile.headers[c])).toEqual(expect.arrayContaining(['Correo', 'Teléfono', 'Ciudad']));
        expect(plan.folder_name).toBe('Facturacion octubre');
    });

    it('dos hojas: la columna que nombra registros de la otra hoja se vincula', () => {
        const cHeaders = ['Nombre', 'Email', 'Ciudad'];
        const cRows = CLIENTS.map((c) => [c[0]!, c[1]!, c[3]!]).concat([['Zeta SAS', 'z@zeta.co', 'Cali'], ['Omega', 'o@omega.co', 'Pasto']]);
        const pHeaders = ['Pedido', 'Cliente', 'Valor', 'Estado'];
        const pRows = Array.from({ length: 18 }, (_, i) => [`P-${i + 1}`, cRows[i % cRows.length]![0]!, String(50000 + i * 100), i % 2 ? 'Entregado' : 'Pendiente']);
        const c = profileSheet(0, 'Clientes', cHeaders, cRows, { numberFormat: 'dot_comma' });
        const p = profileSheet(1, 'Pedidos', pHeaders, pRows, { numberFormat: 'dot_comma' });
        const plan = buildDraftPlan(
            [
                { profile: c, rows: cRows },
                { profile: p, rows: pRows },
            ],
            { fileName: 'ventas.xlsx' },
        );
        expect(plan.lists.map((l) => l.name)).toEqual(['Clientes', 'Pedidos']);
        expect(plan.links).toHaveLength(1);
        expect(plan.links[0]).toMatchObject({ sheet: 1, column: 1, to: 'clientes', include: true, match: 1 });
        // La columna vinculada no se separa como otra lista.
        expect(plan.entities).toHaveLength(0);

        const resolved = resolveFileImportPlan(plan, [c, p]);
        expect(resolved.errors).toEqual([]);
        const pedidos = resolved.lists.find((l) => l.key === 'pedidos')!;
        expect(pedidos.fields.find((f) => f.column === 1)).toMatchObject({ type: 'relation', relation_to: 'clientes' });
    });
});

describe('file-import · resolver el plan', () => {
    function invoicePlan(): { plan: FileImportPlan; profile: ReturnType<typeof profileSheet> } {
        const rows = invoiceRows();
        const profile = profileSheet(0, 'Facturas', INVOICE_HEADERS, rows, { numberFormat: 'dot_comma', dateFormat: 'dmy' });
        return { plan: buildDraftPlan([{ profile, rows }], { fileName: 'facturas.csv' }), profile };
    }

    it('la lista separada se lleva sus columnas y la hoja queda vinculada', () => {
        const { plan, profile } = invoicePlan();
        const r = resolveFileImportPlan(plan, [profile]);
        expect(r.errors).toEqual([]);
        expect(r.lists.map((l) => l.name)).toEqual(['Facturas', 'Clientes']);
        const facturas = r.lists[0]!;
        expect(facturas.fields.map((f) => f.label)).not.toContain('Correo');
        expect(facturas.fields.find((f) => f.slug === 'cliente')).toMatchObject({ type: 'relation', relation_to: 'clientes' });
        const clientes = r.lists[1]!;
        expect(clientes.title_slug).toBe('nombre');
        expect(clientes.fields.map((f) => f.type)).toEqual(['text', 'email', 'phone', 'select']);
        expect(r.records).toBe(24 + 4);
        expect(r.folder_name).toBe('Facturas');
    });

    it('sin la separación todo queda en una lista', () => {
        const { plan, profile } = invoicePlan();
        plan.entities[0]!.include = false;
        const r = resolveFileImportPlan(plan, [profile]);
        expect(r.lists).toHaveLength(1);
        expect(r.lists[0]!.fields.find((f) => f.label === 'Correo')?.type).toBe('email');
        expect(r.folder_name).toBeNull();
    });

    it('errores claros: título descartado o que no es texto, opción faltante, demasiadas listas', () => {
        const { plan, profile } = invoicePlan();
        const list = plan.lists[0]!;
        const title = list.fields.find((f) => f.column === list.title_column)!;
        title.include = false;
        const estado = list.fields.find((f) => f.label === 'Estado')!;
        estado.options = [];
        let r = resolveFileImportPlan(plan, [profile]);
        expect(r.errors.join(' ')).toMatch(/hace de título y no se puede descartar/);
        expect(r.errors.join(' ')).toMatch(/agrega al menos una opción/);

        title.include = true;
        title.type = 'number';
        r = resolveFileImportPlan(plan, [profile]);
        expect(r.errors.join(' ')).toMatch(/tiene que ser una columna de texto/);

        const many: FileImportPlan = { ...plan, entities: Array.from({ length: 6 }, (_, i) => ({ ...plan.entities[0]!, key: `e${i}`, name: `E${i}` })) };
        r = resolveFileImportPlan(many, [profile]);
        expect(r.errors.join(' ')).toMatch(/máximo de una vez es 6/);
    });

    it('un vínculo hacia una lista que no se crea queda como texto, con aviso', () => {
        const plan: FileImportPlan = {
            version: 1,
            kind: 'generic',
            summary: '',
            ai_used: false,
            lists: [
                { sheet: 0, key: 'a', name: 'A', include: true, title_column: 0, skip_duplicates: false, fields: [{ column: 0, include: true, label: 'Nombre', slug: 'nombre', type: 'text' }, { column: 1, include: true, label: 'Otro', slug: 'otro', type: 'text' }] },
                { sheet: 1, key: 'b', name: 'B', include: false, title_column: 0, skip_duplicates: false, fields: [{ column: 0, include: true, label: 'Nombre', slug: 'nombre', type: 'text' }] },
            ],
            entities: [],
            links: [{ sheet: 0, column: 1, to: 'b', include: true }],
        };
        const prof = (i: number) => profileSheet(i, `S${i}`, ['Nombre', 'Otro'], [['x', 'y']]);
        const r = resolveFileImportPlan(plan, [prof(0), prof(1)]);
        expect(r.errors).toEqual([]);
        expect(r.notes[0]).toMatch(/queda como texto/);
        expect(r.lists[0]!.fields[1]!.type).toBe('text');
    });
});

describe('file-import · leer celdas', () => {
    it('opciones por etiqueta, valor o forma del archivo', () => {
        const read = makeFileImportCellReader({
            column: 0,
            label: 'Estado',
            slug: 'estado',
            type: 'select',
            options: [{ value: 'pagada', label: 'Pagada', aliases: ['PAGADA', 'pagado'] }],
        });
        expect(read('pagado')).toBe('pagada');
        expect(read(' PAGADA ')).toBe('pagada');
        expect(read('Otra cosa')).toBe('Otra cosa');
        expect(read('')).toBeNull();
    });

    it('varias opciones, números, porcentajes y fechas con el formato de la columna', () => {
        const multi = makeFileImportCellReader({
            column: 0,
            label: 'Servicios',
            slug: 'servicios',
            type: 'multi_select',
            options: [
                { value: 'web', label: 'Web', aliases: [] },
                { value: 'seo', label: 'SEO', aliases: [] },
            ],
        });
        expect(multi('Web, seo, web')).toEqual(['web', 'seo']);
        const money = makeFileImportCellReader({ column: 0, label: 'Valor', slug: 'valor', type: 'currency', number_format: 'dot_comma' });
        expect(money('$ 1.500.000')).toBe(1500000);
        const frac = makeFileImportCellReader({ column: 0, label: 'Avance', slug: 'avance', type: 'percent', number_format: 'comma_dot', percent_scale: 100 });
        expect(frac('0.75')).toBe(75);
        expect(frac('40%')).toBe(40);
        const date = makeFileImportCellReader({ column: 0, label: 'Fecha', slug: 'fecha', type: 'date', date_order: 'mdy' });
        expect(date('03/04/2026')).toBe('2026-03-04');
        const web = makeFileImportCellReader({ column: 0, label: 'Web', slug: 'web', type: 'url' });
        expect(web('www.acme.co')).toBe('https://www.acme.co');
    });
});
