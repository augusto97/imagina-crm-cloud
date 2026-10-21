import type { RichNode } from '../schemas/rich-text';
import type { TemplateRoleField } from '../schemas/templates';
import {
    DOC_DESIGN_VERSION,
    type DocBlock,
    type DocDesign,
    type DocInnerBlock,
    type DocItemExpr,
    type DocItemsColumn,
    type DocItemsSource,
    type DocTheme,
    type DocTotalRow,
} from '../schemas/document-design';

/**
 * v0.1.266 — Plantillas de arranque de documentos PDF (ADR-S35).
 *
 * Igual que las plantillas de dashboards y automatizaciones (v0.1.167), un
 * documento se aplica sobre una lista que YA existe: la plantilla no conoce
 * los campos, habla de ROLES ("el nombre del cliente", "el valor a cobrar")
 * y quien la usa elige qué campo cumple cada uno. Además pide los datos de
 * QUIEN COBRA (nombre, documento, cuenta bancaria), que van escritos en la
 * plantilla una sola vez. Lo que no se mapea queda como un texto entre
 * corchetes bien visible ("[Nombre del cliente]") para completarlo en el
 * editor — nunca una variable rota.
 */

export interface DocumentIssuer {
    /** Persona o empresa que cobra. */
    name: string;
    /** "C.C." / "NIT" / "C.E.". */
    doc_label: string;
    doc_number: string;
    phone: string;
    email: string;
    address: string;
    /** Ciudad de expedición ("Bogotá, 8 de octubre de 2026"). */
    city: string;
    bank: string;
    /** "ahorros" / "corriente". */
    account_type: string;
    account_number: string;
    /** Titular (vacío = el mismo nombre). */
    account_holder: string;
    /** Nota tributaria del pie (régimen). */
    tax_note: string;
}

export const DEFAULT_TAX_NOTE =
    'Declaro que no soy responsable del impuesto sobre las ventas (IVA) y que no estoy obligado(a) a expedir factura de venta.';

export function emptyIssuer(name = ''): DocumentIssuer {
    return {
        name,
        doc_label: 'C.C.',
        doc_number: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        bank: '',
        account_type: 'ahorros',
        account_number: '',
        account_holder: '',
        tax_note: DEFAULT_TAX_NOTE,
    };
}

export interface DocumentStarter {
    key: string;
    name: string;
    description: string;
    /** Roles sobre los campos de la lista del documento. */
    roles: TemplateRoleField[];
    /** Roles sobre la lista de los ítems (vacío = sin tabla de ítems). */
    item_roles: TemplateRoleField[];
    /** ¿Pide los datos de quien cobra? */
    issuer: boolean;
    /** v0.1.292 — ¿Pregunta por el IVA (tarifa / no responsable) y el descuento global? */
    taxes?: boolean;
    /** v0.1.292 — «Congelar el documento al emitirlo» encendido de entrada. */
    freeze_default?: boolean;
    /** v0.1.292 — Aviso visible en la galería ("No es factura electrónica DIAN"). */
    notice?: string;
}

/** v0.1.292 — IVA de la cotización/factura: tarifa, o «no responsable» (sin IVA). */
export interface DocumentTaxInput {
    /** false = no responsable de IVA: no hay fila de IVA y va la leyenda. */
    iva: boolean;
    /** Tarifa en % (19 en Colombia). */
    rate: number;
}

export interface DocumentStarterInput {
    accent?: string | null;
    /** rol → slug del campo (null o ausente = sin mapear). */
    fields?: Record<string, string | null | undefined>;
    items?: {
        source: DocItemsSource | null;
        fields: Record<string, string | null | undefined>;
    } | null;
    issuer?: DocumentIssuer | null;
    /** v0.1.292 — IVA (sólo plantillas con `taxes`). Por defecto 19 %. */
    tax?: DocumentTaxInput | null;
    /**
     * v0.1.292 — Descuento global % fijo (sin un campo «descuento global»
     * mapeado). 0 o vacío = sin descuento global.
     */
    global_discount_pct?: number | null;
    /** v0.1.292 — Decimales de la moneda (los del campo del precio). Por defecto 0. */
    money_decimals?: number | null;
    /** v0.1.292 — Congelar el documento al emitirlo (por defecto, el de la plantilla). */
    freeze?: boolean | null;
    /** v0.1.292 — Cotización sin campo de validez: válida por N días desde hoy. */
    validity_days?: number | null;
}

/** v0.1.292 — IVA por defecto de las plantillas con impuestos (Colombia). */
export const DEFAULT_IVA_RATE = 19;

export interface DocumentStarterResult {
    name: string;
    filename: string;
    design: DocDesign;
}

const CLIENT_ROLES: TemplateRoleField[] = [
    { key: 'cliente', label: 'Nombre del cliente', types: ['text', 'long_text', 'lookup', 'email', 'select'], required: true },
    { key: 'cliente_doc', label: 'NIT o cédula del cliente', types: ['text', 'number', 'lookup'], required: false },
    { key: 'numero', label: 'Número del documento', types: ['text', 'number'], required: false },
    { key: 'fecha', label: 'Fecha del documento', types: ['date', 'datetime'], required: false },
    { key: 'vencimiento', label: 'Fecha límite de pago', types: ['date', 'datetime'], required: false },
];

const MONEY_TYPES: TemplateRoleField['types'] = ['currency', 'number', 'computed', 'rollup', 'lookup'];

/** v0.1.292 — Datos de contacto del cliente (cotización y factura). */
const CUSTOMER_ROLES: TemplateRoleField[] = [
    { key: 'cliente', label: 'Nombre del cliente', types: ['text', 'long_text', 'lookup', 'email', 'select'], required: true },
    { key: 'cliente_doc', label: 'NIT o cédula del cliente', types: ['text', 'number', 'lookup'], required: false },
    { key: 'direccion', label: 'Dirección del cliente', types: ['text', 'long_text', 'lookup'], required: false },
    { key: 'correo', label: 'Correo del cliente', types: ['email', 'text', 'lookup'], required: false },
];

/** v0.1.292 — Las líneas de una cotización o factura (lista vinculada). */
const LINE_ITEM_ROLES: TemplateRoleField[] = [
    { key: 'descripcion', label: 'Descripción', types: ['text', 'long_text', 'select', 'lookup'], required: true },
    { key: 'cantidad', label: 'Cantidad', types: ['number', 'rollup', 'lookup', 'computed'], required: true },
    { key: 'precio', label: 'Precio unitario', types: MONEY_TYPES, required: true },
    { key: 'descuento', label: 'Descuento % por línea', types: ['percent', 'number'], required: false },
];

const GLOBAL_DISCOUNT_ROLE: TemplateRoleField = {
    key: 'descuento_global',
    label: 'Descuento global %',
    types: ['percent', 'number'],
    required: false,
};

/** v0.1.292 — El aviso de la factura en la galería. */
export const DIAN_NOTICE =
    'No es factura electrónica DIAN: sirve como soporte o cuenta para tus clientes, pero no reemplaza la factura electrónica de venta.';

export const DOCUMENT_STARTERS: readonly DocumentStarter[] = [
    {
        key: 'cuenta_cobro',
        name: 'Cuenta de cobro',
        description: 'Un concepto y un valor, con el monto en letras, tus datos bancarios y la firma. La de todos los meses.',
        roles: [
            ...CLIENT_ROLES,
            { key: 'concepto', label: 'Concepto (qué se cobra)', types: ['text', 'long_text', 'select', 'lookup'], required: false },
            { key: 'valor', label: 'Valor a cobrar', types: MONEY_TYPES, required: true },
        ],
        item_roles: [],
        issuer: true,
    },
    {
        key: 'cuenta_cobro_detalle',
        name: 'Cuenta de cobro con detalle',
        description: 'Con una tabla de ítems (servicios, horas, cuotas) sacada de los registros vinculados y el total sumado solo.',
        roles: [
            ...CLIENT_ROLES,
            { key: 'concepto', label: 'Concepto general (opcional)', types: ['text', 'long_text', 'select', 'lookup'], required: false },
        ],
        item_roles: [
            { key: 'descripcion', label: 'Descripción del ítem', types: ['text', 'long_text', 'select', 'lookup'], required: true },
            { key: 'cantidad', label: 'Cantidad', types: ['number', 'rollup', 'lookup', 'computed'], required: false },
            { key: 'valor_unitario', label: 'Valor unitario', types: MONEY_TYPES, required: false },
            { key: 'total', label: 'Valor de la línea', types: MONEY_TYPES, required: true },
        ],
        issuer: true,
    },
    {
        key: 'cotizacion',
        name: 'Cotización',
        description: 'Ítems con cantidad, precio y descuento por línea, el total de cada línea calculado, IVA, validez y condiciones comerciales.',
        roles: [
            ...CUSTOMER_ROLES,
            { key: 'numero', label: 'Número de la cotización', types: ['text', 'number'], required: false },
            { key: 'fecha', label: 'Fecha de la cotización', types: ['date', 'datetime'], required: false },
            { key: 'validez', label: 'Válida hasta (fecha de vencimiento)', types: ['date', 'datetime'], required: false },
            { key: 'condiciones', label: 'Condiciones comerciales', types: ['long_text', 'text'], required: false },
            GLOBAL_DISCOUNT_ROLE,
        ],
        item_roles: LINE_ITEM_ROLES,
        issuer: true,
        taxes: true,
        freeze_default: false,
    },
    {
        key: 'factura',
        name: 'Factura (no electrónica)',
        description: 'Ítems con el total de cada línea calculado, descuentos, base gravable, IVA, forma de pago y tus datos bancarios.',
        roles: [
            ...CUSTOMER_ROLES,
            { key: 'numero', label: 'Número de la factura', types: ['text', 'number'], required: false },
            { key: 'fecha', label: 'Fecha de emisión', types: ['date', 'datetime'], required: false },
            { key: 'fecha_pago', label: 'Fecha de pago (límite)', types: ['date', 'datetime'], required: false },
            { key: 'forma_pago', label: 'Forma de pago', types: ['select', 'text', 'long_text'], required: false },
            GLOBAL_DISCOUNT_ROLE,
        ],
        item_roles: LINE_ITEM_ROLES,
        issuer: true,
        taxes: true,
        freeze_default: true,
        notice: DIAN_NOTICE,
    },
    {
        key: 'blank',
        name: 'En blanco',
        description: 'Una hoja con un encabezado para armar el documento desde cero.',
        roles: [],
        item_roles: [],
        issuer: false,
    },
];

// ---------------------------------------------------------------------------

const txt = (text: string, bold = false): RichNode => (bold ? { type: 'text', text, marks: [{ type: 'bold' }] } : { type: 'text', text });
const para = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content: content.filter((c) => c.text !== '') });
const doc = (...paragraphs: RichNode[]): RichNode => ({ type: 'doc', content: paragraphs });

function theme(accent: string | null | undefined): DocTheme {
    return {
        page_size: 'letter',
        orientation: 'portrait',
        margin: 'normal',
        font_size: 10,
        text: '#1f2937',
        muted: '#6b7280',
        accent: accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#0e7490',
        border: '#e5e7eb',
        font: 'modern',
    };
}

/**
 * Arma el diseño de una plantilla de arranque con los campos elegidos.
 * Puro: lo usa el front (galería) y los tests.
 */
export function buildDocumentStarter(key: string, input: DocumentStarterInput = {}): DocumentStarterResult {
    const starter = DOCUMENT_STARTERS.find((s) => s.key === key) ?? DOCUMENT_STARTERS[DOCUMENT_STARTERS.length - 1]!;
    const fields = input.fields ?? {};
    const issuer = input.issuer ?? emptyIssuer();
    const roleLabel = (k: string): string => starter.roles.find((r) => r.key === k)?.label ?? k;
    const slug = (k: string): string | null => {
        const s = fields[k];
        return typeof s === 'string' && s !== '' ? s : null;
    };
    /** `{{slug|mods}}` o el marcador visible "[Etiqueta]". */
    const tag = (k: string, mods = ''): string => {
        const s = slug(k);
        return s ? `{{${s}${mods}}}` : `[${roleLabel(k)}]`;
    };
    let n = 0;
    const id = (p: string): string => `${p}${++n}`;

    if (starter.key === 'cotizacion' || starter.key === 'factura') {
        return buildSalesDocument(starter, input, { tag, slug, id });
    }

    if (starter.key === 'blank') {
        return {
            name: 'Documento',
            filename: 'Documento {{record.id}}',
            design: {
                version: DOC_DESIGN_VERSION,
                theme: theme(input.accent),
                footer: { text: '', page_numbers: true },
                numbering: { enabled: false, prefix: '', padding: 4, start: 1, save_field: null },
                blocks: [
                    {
                        id: id('h'),
                        type: 'header',
                        layout: 'split',
                        logo: { kind: 'brand', file_id: null, url: '' },
                        logo_width: 110,
                        company: issuer.name || 'Tu empresa',
                        title: 'DOCUMENTO',
                        number: 'N.º {{record.id}}',
                        date: '{{date.today|larga}}',
                    },
                    { id: id('t'), type: 'text', doc: doc(para(txt('Escribe aquí el contenido del documento.'))), align: 'left', size: 'md' },
                ],
            },
        };
    }

    const docId = `${issuer.doc_label || 'C.C.'} ${issuer.doc_number}`.trim();
    const issuerName = issuer.name.trim() || '[Tu nombre o el de tu empresa]';
    const company = [
        issuerName,
        issuer.doc_number ? docId : '',
        issuer.address,
        [issuer.phone, issuer.email].filter(Boolean).join(' · '),
    ]
        .filter((l) => l.trim() !== '')
        .join('\n');
    // v0.1.267 — Sin un campo "número" propio, la plantilla numera sola
    // (consecutivo de la plantilla: 0001, 0002…), que es lo que espera quien
    // recibe una cuenta de cobro; el id del registro no es un consecutivo.
    const ownNumber = slug('numero') !== null;
    const numero = ownNumber ? tag('numero') : '{{documento.numero}}';
    const fecha = slug('fecha') ? tag('fecha', '|larga') : '{{date.today|larga}}';
    const withItems = starter.item_roles.length > 0;
    const blocks: DocBlock[] = [];

    blocks.push({
        id: id('h'),
        type: 'header',
        layout: 'split',
        logo: { kind: 'brand', file_id: null, url: '' },
        logo_width: 110,
        company,
        title: 'CUENTA DE COBRO',
        number: `N.º ${numero}`,
        date: issuer.city.trim() ? `${issuer.city.trim()}, ${fecha}` : fecha,
    });
    blocks.push({ id: id('s'), type: 'spacer', height: 12 });

    // Las dos partes: a quién se le cobra y a quién se le paga.
    const boxBg = '#f8fafc';
    const party = (title: string, lines: RichNode[]): DocInnerBlock[] => [
        { id: id('ht'), type: 'heading', text: title, level: 3, align: 'left', color: null },
        { id: id('pt'), type: 'text', doc: doc(...lines), align: 'left', size: 'md', background: boxBg, padding: 'md' },
    ];
    const clientDoc = slug('cliente_doc') ? [para(txt('NIT / C.C. '), txt(tag('cliente_doc')))] : [];
    blocks.push({
        id: id('c'),
        type: 'columns',
        columns: [
            { blocks: party('CLIENTE', [para(txt(tag('cliente'), true)), ...clientDoc]) },
            { blocks: party('PAGAR A', [para(txt(issuerName, true)), ...(issuer.doc_number ? [para(txt(docId))] : [])]) },
        ],
    });
    blocks.push({ id: id('s'), type: 'spacer', height: 12 });

    const itemsId = 'items';
    if (withItems) {
        if (slug('concepto')) {
            blocks.push({ id: id('ct'), type: 'text', doc: doc(para(txt('Por concepto de: ', true), txt(tag('concepto')))), align: 'left', size: 'md' });
            blocks.push({ id: id('s'), type: 'spacer', height: 8 });
        }
        const items = input.items ?? null;
        const itemSlug = (k: string): string | null => {
            const s = items?.fields[k];
            return typeof s === 'string' && s !== '' ? s : null;
        };
        const columns = [
            itemSlug('descripcion') ? { slug: itemSlug('descripcion')!, label: 'Descripción', align: 'left' as const, width: 'fill' as const } : null,
            itemSlug('cantidad') ? { slug: itemSlug('cantidad')!, label: 'Cant.', align: 'center' as const, width: 'auto' as const } : null,
            itemSlug('valor_unitario') ? { slug: itemSlug('valor_unitario')!, label: 'Valor unitario', align: 'right' as const, width: 'auto' as const } : null,
            itemSlug('total') ? { slug: itemSlug('total')!, label: 'Valor', align: 'right' as const, width: 'auto' as const } : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null);
        blocks.push({
            id: itemsId,
            type: 'items',
            title: 'DETALLE',
            source: items?.source ?? null,
            columns,
            numbered: true,
            sort: null,
            limit: 200,
            striped: true,
            empty_text: 'Sin ítems.',
        });
        blocks.push({ id: id('s'), type: 'spacer', height: 6 });
        blocks.push({
            id: 'totals',
            type: 'totals',
            rows: [
                {
                    id: 'total',
                    label: 'TOTAL A PAGAR',
                    source: itemSlug('total')
                        ? { kind: 'items_sum', block_id: itemsId, slug: itemSlug('total')! }
                        : { kind: 'text', value: '[Elige la columna del valor]' },
                    emphasis: true,
                },
            ],
            width: 'half',
            prefix: '$ ',
            decimals: 0,
        });
    } else {
        blocks.push({ id: id('ht'), type: 'heading', text: 'POR CONCEPTO DE', level: 3, align: 'left', color: null });
        blocks.push({ id: id('ct'), type: 'text', doc: doc(para(txt(tag('concepto')))), align: 'left', size: 'md' });
        blocks.push({ id: id('s'), type: 'spacer', height: 10 });
        blocks.push({
            id: 'totals',
            type: 'totals',
            rows: [
                {
                    id: 'total',
                    label: 'VALOR TOTAL',
                    source: slug('valor') ? { kind: 'field', slug: slug('valor')! } : { kind: 'text', value: '[Valor a cobrar]' },
                    emphasis: true,
                },
            ],
            width: 'half',
            prefix: '$ ',
            decimals: 0,
        });
    }

    // El monto en letras: de la fila del total (sale igual con o sin ítems).
    blocks.push({ id: id('s'), type: 'spacer', height: 8 });
    blocks.push({
        id: id('w'),
        type: 'text',
        doc: doc(para(txt('Son: ', true), txt('{{totales.total|pesos|mayusculas}} M/CTE.'))),
        align: 'left',
        size: 'md',
        background: boxBg,
        padding: 'md',
    });

    const bank = issuer.bank.trim() && issuer.account_number.trim();
    const due = slug('vencimiento');
    if (bank || due) {
        blocks.push({ id: id('s'), type: 'spacer', height: 10 });
        blocks.push({ id: id('ht'), type: 'heading', text: 'FORMA DE PAGO', level: 3, align: 'left', color: null });
        const lines: RichNode[] = [];
        if (bank) {
            const holder = issuer.account_holder.trim() || issuerName;
            lines.push(
                para(
                    txt('Consignar o transferir a la cuenta de '),
                    txt(`${issuer.account_type || 'ahorros'} N.º ${issuer.account_number.trim()}`, true),
                    txt(` de ${issuer.bank.trim()}, a nombre de ${holder}${issuer.doc_number ? ` (${docId})` : ''}.`),
                ),
            );
        }
        if (due) lines.push(para(txt('Fecha límite de pago: ', true), txt(tag('vencimiento', '|larga'))));
        blocks.push({ id: id('pt'), type: 'text', doc: doc(...lines), align: 'left', size: 'md' });
    }

    if (issuer.tax_note.trim()) {
        blocks.push({ id: id('s'), type: 'spacer', height: 10 });
        blocks.push({
            id: id('tn'),
            type: 'text',
            doc: doc(para(txt(issuer.tax_note.trim()))),
            align: 'left',
            size: 'sm',
            color: '#6b7280',
        });
    }

    blocks.push({ id: id('s'), type: 'spacer', height: 24 });
    blocks.push({
        id: id('g'),
        type: 'signature',
        signers: [{ name: issuerName, detail: issuer.doc_number ? docId : '' }],
        align: 'left',
        image: { kind: 'none', file_id: null, url: '' },
        line: true,
    });

    const clientInName = slug('cliente') ? ` - ${tag('cliente')}` : '';
    return {
        name: starter.name,
        filename: `Cuenta de cobro ${numero}${clientInName}`,
        design: {
            version: DOC_DESIGN_VERSION,
            theme: theme(input.accent),
            footer: { text: '', page_numbers: withItems },
            numbering: { enabled: !ownNumber, prefix: '', padding: 4, start: 1, save_field: null },
            blocks,
        },
    };
}

// ---------------------------------------------------------------------------
// v0.1.292 — Cotización y factura (no electrónica)
// ---------------------------------------------------------------------------

/** Claves de las columnas calculadas (no chocan con un slug: llevan prefijo). */
export const DOC_CALC_GROSS = 'calc_bruto';
export const DOC_CALC_LINE_TOTAL = 'calc_total';
export const DOC_CALC_LINE_DISCOUNT = 'calc_descuento';

/**
 * El diseño de una cotización o una factura: los ítems con el total de cada
 * línea CALCULADO (cantidad × precio − descuento %) y los totales Subtotal →
 * Descuentos → Descuento global → Base gravable → IVA → Total. El IVA va
 * sobre la base gravable (lo que queda después de TODOS los descuentos), como
 * en una factura de verdad.
 */
function buildSalesDocument(
    starter: DocumentStarter,
    input: DocumentStarterInput,
    h: { tag: (k: string, mods?: string) => string; slug: (k: string) => string | null; id: (p: string) => string },
): DocumentStarterResult {
    const { tag, slug, id } = h;
    const quote = starter.key === 'cotizacion';
    const issuer = input.issuer ?? emptyIssuer();
    const tax: DocumentTaxInput = input.tax ?? { iva: true, rate: DEFAULT_IVA_RATE };
    const rate = Number.isFinite(tax.rate) ? Math.max(0, Math.min(100, tax.rate)) : DEFAULT_IVA_RATE;
    const decimals = Math.max(0, Math.min(4, Math.trunc(input.money_decimals ?? 0)));
    const rawGlobal = input.global_discount_pct;
    const globalPct = typeof rawGlobal === 'number' && Number.isFinite(rawGlobal) ? Math.max(0, Math.min(100, rawGlobal)) : 0;
    const freeze = input.freeze ?? starter.freeze_default ?? false;
    const pctLabel = (n: number): string => String(n).replace('.', ',');

    const docId = `${issuer.doc_label || 'C.C.'} ${issuer.doc_number}`.trim();
    const issuerName = issuer.name.trim() || '[Tu nombre o el de tu empresa]';
    const company = [issuerName, issuer.doc_number ? docId : '', issuer.address, [issuer.phone, issuer.email].filter(Boolean).join(' · ')]
        .filter((l) => l.trim() !== '')
        .join('\n');
    const ownNumber = slug('numero') !== null;
    const numero = ownNumber ? tag('numero') : '{{documento.numero}}';
    const fecha = slug('fecha') ? tag('fecha', '|larga') : '{{date.today|larga}}';
    const blocks: DocBlock[] = [];
    const boxBg = '#f8fafc';

    blocks.push({
        id: id('h'),
        type: 'header',
        layout: 'split',
        logo: { kind: 'brand', file_id: null, url: '' },
        logo_width: 110,
        company,
        title: quote ? 'COTIZACIÓN' : 'FACTURA',
        number: `N.º ${numero}`,
        date: issuer.city.trim() ? `${issuer.city.trim()}, ${fecha}` : fecha,
    });
    blocks.push({ id: id('s'), type: 'spacer', height: 12 });

    // A quién se le cotiza/factura | los datos del documento.
    const clientLines: RichNode[] = [para(txt(tag('cliente'), true))];
    if (slug('cliente_doc')) clientLines.push(para(txt('NIT / C.C. '), txt(tag('cliente_doc'))));
    if (slug('direccion')) clientLines.push(para(txt(tag('direccion'))));
    if (slug('correo')) clientLines.push(para(txt(tag('correo'))));
    const infoLines: RichNode[] = [para(txt(quote ? 'Fecha: ' : 'Fecha de emisión: ', true), txt(fecha))];
    if (quote) {
        const days = Math.max(1, Math.trunc(input.validity_days ?? 30));
        infoLines.push(para(txt('Válida hasta: ', true), txt(slug('validez') ? tag('validez', '|larga') : `{{date.today|+${days}d|larga}}`)));
    } else {
        if (slug('fecha_pago')) infoLines.push(para(txt('Fecha de pago: ', true), txt(tag('fecha_pago', '|larga'))));
        if (slug('forma_pago')) infoLines.push(para(txt('Forma de pago: ', true), txt(tag('forma_pago'))));
    }
    const party = (title: string, lines: RichNode[]): DocInnerBlock[] => [
        { id: id('ht'), type: 'heading', text: title, level: 3, align: 'left', color: null },
        { id: id('pt'), type: 'text', doc: doc(...lines), align: 'left', size: 'md', background: boxBg, padding: 'md' },
    ];
    blocks.push({
        id: id('c'),
        type: 'columns',
        columns: [{ blocks: party('CLIENTE', clientLines) }, { blocks: party(quote ? 'COTIZACIÓN' : 'FACTURA', infoLines) }],
    });
    blocks.push({ id: id('s'), type: 'spacer', height: 12 });

    // Ítems: lo mapeado como columna de campo; lo que falta, como columna
    // marcadora "[Precio unitario]" bien visible para completarla en el editor.
    const items = input.items ?? null;
    const itemSlug = (k: string): string | null => {
        const v = items?.fields[k];
        return typeof v === 'string' && v !== '' ? v : null;
    };
    const itemLabel = (k: string): string => starter.item_roles.find((r) => r.key === k)?.label ?? k;
    const ref = (k: string): string => itemSlug(k) ?? `[${itemLabel(k)}]`;
    const fieldCol = (k: string, label: string, align: 'left' | 'center' | 'right', width: 'auto' | 'fill' = 'auto'): DocItemsColumn => ({
        slug: ref(k),
        label,
        align,
        width,
    });
    const col = (key: string): DocItemExpr => ({ op: 'col', slug: key });
    const hasDiscount = itemSlug('descuento') !== null;
    const money = { kind: 'computed' as const, format: 'currency' as const, decimals, prefix: '$ ' };
    const columns: DocItemsColumn[] = [
        fieldCol('descripcion', 'Descripción', 'left', 'fill'),
        fieldCol('cantidad', 'Cant.', 'center'),
        // El precio unitario con el MISMO formato que el total de la línea.
        { ...fieldCol('precio', 'Precio unitario', 'right'), format: 'currency', decimals, prefix: '$ ' },
    ];
    if (hasDiscount) columns.push(fieldCol('descuento', 'Desc. %', 'center'));
    columns.push({
        slug: DOC_CALC_GROSS,
        label: 'Bruto',
        align: 'right',
        width: 'auto',
        ...money,
        expr: { op: 'mul', args: [col(ref('cantidad')), col(ref('precio'))] },
        hidden: true,
    });
    columns.push({
        slug: DOC_CALC_LINE_TOTAL,
        label: 'Total',
        align: 'right',
        width: 'auto',
        ...money,
        expr: hasDiscount ? { op: 'minus_pct', of: col(DOC_CALC_GROSS), pct: col(ref('descuento')) } : col(DOC_CALC_GROSS),
    });
    if (hasDiscount) {
        // El descuento de cada línea, en negativo (para la fila «Descuentos»).
        columns.push({
            slug: DOC_CALC_LINE_DISCOUNT,
            label: 'Descuento',
            align: 'right',
            width: 'auto',
            ...money,
            expr: { op: 'sub', args: [col(DOC_CALC_LINE_TOTAL), col(DOC_CALC_GROSS)] },
            hidden: true,
        });
    }
    const itemsId = 'items';
    blocks.push({
        id: itemsId,
        type: 'items',
        title: 'DETALLE',
        source: items?.source ?? null,
        columns,
        numbered: true,
        sort: null,
        limit: 200,
        striped: true,
        empty_text: 'Sin ítems.',
    });
    blocks.push({ id: id('s'), type: 'spacer', height: 6 });

    // Totales.
    const rows: DocTotalRow[] = [
        { id: 'subtotal', label: 'Subtotal', source: { kind: 'items_sum', block_id: itemsId, slug: DOC_CALC_GROSS }, emphasis: false },
    ];
    let net = 'subtotal';
    if (hasDiscount) {
        rows.push({
            id: 'descuentos',
            label: 'Descuentos',
            source: { kind: 'items_sum', block_id: itemsId, slug: DOC_CALC_LINE_DISCOUNT },
            emphasis: false,
            hide_zero: true,
        });
        rows.push({ id: 'neto', label: 'Neto', source: { kind: 'sum', rows: ['subtotal', 'descuentos'], minus: [] }, emphasis: false, hidden: true });
        net = 'neto';
    }
    const globalField = slug('descuento_global');
    const withGlobal = globalField !== null || globalPct > 0;
    if (withGlobal) {
        rows.push({
            id: 'descuento_global',
            label: globalField ? 'Descuento global' : `Descuento global (${pctLabel(globalPct)} %)`,
            source: { kind: 'percent', of: net, pct: globalPct, pct_field: globalField, negate: true },
            emphasis: false,
            hide_zero: true,
        });
    }
    const afterDiscounts = withGlobal ? [net, 'descuento_global'] : [net];
    if (tax.iva) {
        rows.push({ id: 'base', label: 'Base gravable', source: { kind: 'sum', rows: afterDiscounts, minus: [] }, emphasis: false });
        rows.push({ id: 'iva', label: `IVA ${pctLabel(rate)} %`, source: { kind: 'percent', of: 'base', pct: rate }, emphasis: false });
        rows.push({ id: 'total', label: 'TOTAL', source: { kind: 'sum', rows: ['base', 'iva'], minus: [] }, emphasis: true });
    } else {
        rows.push({ id: 'total', label: 'TOTAL', source: { kind: 'sum', rows: afterDiscounts, minus: [] }, emphasis: true });
    }
    blocks.push({ id: 'totals', type: 'totals', rows, width: 'half', prefix: '$ ', decimals });

    blocks.push({ id: id('s'), type: 'spacer', height: 8 });
    blocks.push({
        id: id('w'),
        type: 'text',
        doc: doc(para(txt('Son: ', true), txt('{{totales.total|pesos|mayusculas}} M/CTE.'))),
        align: 'left',
        size: 'md',
        background: boxBg,
        padding: 'md',
    });

    if (quote) {
        blocks.push({ id: id('s'), type: 'spacer', height: 10 });
        blocks.push({ id: id('ht'), type: 'heading', text: 'CONDICIONES COMERCIALES', level: 3, align: 'left', color: null });
        const terms = slug('condiciones')
            ? doc(para(txt(tag('condiciones'))))
            : doc(
                  para(txt('Precios en pesos colombianos.')),
                  para(txt(tax.iva ? `El IVA (${pctLabel(rate)} %) va discriminado en los totales.` : 'Valores sin IVA.')),
                  para(txt('Forma de pago y tiempos de entrega: a convenir.')),
              );
        blocks.push({ id: id('ct'), type: 'text', doc: terms, align: 'left', size: 'md' });
    } else {
        const bank = issuer.bank.trim() !== '' && issuer.account_number.trim() !== '';
        const lines: RichNode[] = [];
        if (bank) {
            const holder = issuer.account_holder.trim() || issuerName;
            lines.push(
                para(
                    txt('Consignar o transferir a la cuenta de '),
                    txt(`${issuer.account_type || 'ahorros'} N.º ${issuer.account_number.trim()}`, true),
                    txt(` de ${issuer.bank.trim()}, a nombre de ${holder}${issuer.doc_number ? ` (${docId})` : ''}.`),
                ),
            );
        } else {
            lines.push(para(txt('[Tus datos bancarios: banco, tipo y número de cuenta]')));
        }
        blocks.push({ id: id('s'), type: 'spacer', height: 10 });
        blocks.push({ id: id('ht'), type: 'heading', text: 'DATOS PARA EL PAGO', level: 3, align: 'left', color: null });
        blocks.push({ id: id('pt'), type: 'text', doc: doc(...lines), align: 'left', size: 'md' });
    }

    // Sin IVA: la leyenda de no responsable (la nota de quien emite).
    if (!tax.iva) {
        const note = issuer.tax_note.trim() || DEFAULT_TAX_NOTE;
        blocks.push({ id: id('s'), type: 'spacer', height: 10 });
        blocks.push({ id: id('tn'), type: 'text', doc: doc(para(txt(note))), align: 'left', size: 'sm', color: '#6b7280' });
    }

    blocks.push({ id: id('s'), type: 'spacer', height: 24 });
    blocks.push({
        id: id('g'),
        type: 'signature',
        signers: [{ name: issuerName, detail: issuer.doc_number ? docId : '' }],
        align: 'left',
        image: { kind: 'none', file_id: null, url: '' },
        line: true,
    });

    const clientInName = slug('cliente') ? ` - ${tag('cliente')}` : '';
    return {
        name: starter.name,
        filename: `${quote ? 'Cotización' : 'Factura'} ${numero}${clientInName}`,
        design: {
            version: DOC_DESIGN_VERSION,
            theme: theme(input.accent),
            footer: { text: quote ? '' : 'Este documento no es una factura electrónica de venta.', page_numbers: true },
            numbering: {
                enabled: !ownNumber,
                prefix: quote ? 'COT-' : 'FAC-',
                padding: 4,
                start: 1,
                save_field: null,
                freeze: !ownNumber && freeze,
            },
            blocks,
        },
    };
}
