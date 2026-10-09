import type { RichNode } from '../schemas/rich-text';
import type { TemplateRoleField } from '../schemas/templates';
import {
    DOC_DESIGN_VERSION,
    type DocBlock,
    type DocDesign,
    type DocInnerBlock,
    type DocItemsSource,
    type DocTheme,
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
}

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
