import type { RichNode } from '../schemas/rich-text';
import type { EmailDesign, EmailTheme } from '../schemas/email-design';
import { EMAIL_DESIGN_VERSION } from '../schemas/email-design';

/**
 * v0.1.265 — Diseños de arranque del editor de correos (ADR-S34). Usan sólo
 * variables genéricas (`{{record.id}}`, `{{date.today}}`) o ninguna: los
 * campos de cada lista los elige la persona. El color de acento se reemplaza
 * por el de la marca de la empresa al aplicarlos (`withAccent`).
 */

export interface EmailTemplate {
    key: string;
    name: string;
    description: string;
    design: EmailDesign;
}

const theme = (patch: Partial<EmailTheme> = {}): EmailTheme => ({
    background: '#f4f5f7',
    surface: '#ffffff',
    text: '#1f2937',
    muted: '#6b7280',
    accent: '#0e7490',
    font: 'modern',
    width: 600,
    radius: 8,
    dark: { enabled: false, background: '#0f1115', surface: '#1b1d22', text: '#e8eaed', muted: '#a1a7b3' },
    ...patch,
});

/** Documento de texto a partir de párrafos (una línea = un párrafo). */
export function emailTextDoc(...paragraphs: Array<string | RichNode>): RichNode {
    return {
        type: 'doc',
        content: paragraphs.map((p) =>
            typeof p === 'string'
                ? { type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] }
                : p,
        ),
    };
}

const bold = (text: string): RichNode => ({ type: 'text', text, marks: [{ type: 'bold' }] });
const para = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const txt = (text: string): RichNode => ({ type: 'text', text });

export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
    {
        key: 'blank',
        name: 'En blanco',
        description: 'Una hoja vacía para armar desde cero.',
        design: { version: EMAIL_DESIGN_VERSION, theme: theme(), blocks: [] },
    },
    {
        key: 'simple',
        name: 'Mensaje simple',
        description: 'Título, texto y la firma. El correo de todos los días.',
        design: {
            version: EMAIL_DESIGN_VERSION,
            theme: theme(),
            blocks: [
                { id: 'h1', type: 'heading', text: 'Hola', level: 2, align: 'left' },
                {
                    id: 't1',
                    type: 'text',
                    doc: emailTextDoc('Te escribimos para contarte que…', 'Cualquier duda, responde este correo.'),
                    align: 'left',
                    size: 'md',
                },
                { id: 'g1', type: 'signature' },
            ],
        },
    },
    {
        key: 'notice',
        name: 'Aviso con botón',
        description: 'Banda de color con el título, el mensaje y un botón de acción.',
        design: {
            version: EMAIL_DESIGN_VERSION,
            theme: theme(),
            blocks: [
                {
                    id: 'h1',
                    type: 'heading',
                    text: 'Tenemos novedades',
                    level: 1,
                    align: 'center',
                    color: '#ffffff',
                    background: '#0e7490',
                    padding: 'lg',
                },
                {
                    id: 't1',
                    type: 'text',
                    doc: emailTextDoc('Cuéntale aquí a tu cliente qué pasó y qué tiene que hacer.'),
                    align: 'center',
                    size: 'lg',
                    padding: 'md',
                },
                { id: 'b1', type: 'button', label: 'Ver detalles', url: 'https://', align: 'center', full_width: false },
                { id: 's1', type: 'spacer', height: 16 },
                { id: 'd1', type: 'divider', thickness: 1 },
                {
                    id: 'f1',
                    type: 'text',
                    doc: emailTextDoc('Recibes este correo porque eres cliente nuestro.'),
                    align: 'center',
                    size: 'sm',
                    color: '#6b7280',
                },
            ],
        },
    },
    {
        key: 'record',
        name: 'Notificación con datos',
        description: 'Un resumen con los datos del registro en una tabla prolija.',
        design: {
            version: EMAIL_DESIGN_VERSION,
            theme: theme(),
            blocks: [
                { id: 'h1', type: 'heading', text: 'Registro #{{record.id}}', level: 2, align: 'left' },
                {
                    id: 't1',
                    type: 'text',
                    doc: emailTextDoc('Estos son los datos actualizados:'),
                    align: 'left',
                    size: 'md',
                },
                { id: 'f1', type: 'fields', title: '', slugs: [], layout: 'table' },
                { id: 's1', type: 'spacer', height: 8 },
                { id: 'g1', type: 'signature' },
            ],
        },
    },
    {
        key: 'payment',
        name: 'Recordatorio de pago',
        description: 'Monto destacado, fecha de vencimiento y el botón para pagar.',
        design: {
            version: EMAIL_DESIGN_VERSION,
            theme: theme({ accent: '#15803d' }),
            blocks: [
                { id: 'h1', type: 'heading', text: 'Tu factura está lista', level: 1, align: 'left' },
                {
                    id: 't1',
                    type: 'text',
                    doc: {
                        type: 'doc',
                        content: [
                            para(txt('Hola, te recordamos que tienes un pago pendiente.')),
                            para(bold('Monto: '), txt('$ —')),
                            para(bold('Vence: '), txt('—')),
                        ],
                    },
                    align: 'left',
                    size: 'md',
                },
                { id: 'b1', type: 'button', label: 'Pagar ahora', url: '{{pago.link}}', align: 'left', full_width: false },
                { id: 's1', type: 'spacer', height: 12 },
                {
                    id: 't2',
                    type: 'text',
                    doc: emailTextDoc('Si ya pagaste, ignora este mensaje. ¡Gracias!'),
                    align: 'left',
                    size: 'sm',
                    color: '#6b7280',
                },
                { id: 'g1', type: 'signature' },
            ],
        },
    },
    {
        key: 'welcome',
        name: 'Bienvenida',
        description: 'Imagen de cabecera, saludo, tres pasos y un botón.',
        design: {
            version: EMAIL_DESIGN_VERSION,
            theme: theme({ background: '#eef2f7' }),
            blocks: [
                { id: 'i1', type: 'image', src: '', alt: 'Bienvenida', width: 100, align: 'center', link: '', bleed: true },
                { id: 'h1', type: 'heading', text: '¡Bienvenido!', level: 1, align: 'center', padding: 'lg' },
                {
                    id: 't1',
                    type: 'text',
                    doc: emailTextDoc('Gracias por sumarte. Así empiezas:'),
                    align: 'center',
                    size: 'lg',
                },
                {
                    id: 'c1',
                    type: 'columns',
                    padding: 'md',
                    columns: [
                        {
                            blocks: [
                                { id: 'c1h', type: 'heading', text: '1. Completa tus datos', level: 3, align: 'center' },
                                { id: 'c1t', type: 'text', doc: emailTextDoc('Así podemos atenderte mejor.'), align: 'center', size: 'sm' },
                            ],
                        },
                        {
                            blocks: [
                                { id: 'c2h', type: 'heading', text: '2. Conoce el equipo', level: 3, align: 'center' },
                                { id: 'c2t', type: 'text', doc: emailTextDoc('Te asignamos una persona de contacto.'), align: 'center', size: 'sm' },
                            ],
                        },
                        {
                            blocks: [
                                { id: 'c3h', type: 'heading', text: '3. Escríbenos', level: 3, align: 'center' },
                                { id: 'c3t', type: 'text', doc: emailTextDoc('Responde este correo cuando quieras.'), align: 'center', size: 'sm' },
                            ],
                        },
                    ],
                },
                { id: 'b1', type: 'button', label: 'Empezar', url: 'https://', align: 'center', full_width: false, padding: 'md' },
                { id: 'g1', type: 'signature' },
            ],
        },
    },
    {
        key: 'newsletter',
        name: 'Novedades',
        description: 'Título, una imagen y dos noticias lado a lado.',
        design: {
            version: EMAIL_DESIGN_VERSION,
            theme: theme({ font: 'serif', accent: '#9a3412' }),
            blocks: [
                { id: 'h0', type: 'heading', text: 'Novedades del mes', level: 1, align: 'left' },
                {
                    id: 't0',
                    type: 'text',
                    doc: emailTextDoc('Lo más importante de las últimas semanas, en dos minutos.'),
                    align: 'left',
                    size: 'md',
                    color: '#6b7280',
                },
                { id: 'i1', type: 'image', src: '', alt: 'Imagen principal', width: 100, align: 'center', link: '', bleed: false },
                {
                    id: 'c1',
                    type: 'columns',
                    columns: [
                        {
                            blocks: [
                                { id: 'n1h', type: 'heading', text: 'Primera noticia', level: 3, align: 'left' },
                                { id: 'n1t', type: 'text', doc: emailTextDoc('Un resumen corto de la noticia.'), align: 'left', size: 'sm' },
                                { id: 'n1b', type: 'button', label: 'Leer más', url: 'https://', align: 'left', full_width: false },
                            ],
                        },
                        {
                            blocks: [
                                { id: 'n2h', type: 'heading', text: 'Segunda noticia', level: 3, align: 'left' },
                                { id: 'n2t', type: 'text', doc: emailTextDoc('Un resumen corto de la noticia.'), align: 'left', size: 'sm' },
                                { id: 'n2b', type: 'button', label: 'Leer más', url: 'https://', align: 'left', full_width: false },
                            ],
                        },
                    ],
                },
                { id: 'd1', type: 'divider', thickness: 1 },
                { id: 'g1', type: 'signature' },
            ],
        },
    },
];

/** El diseño de una plantilla con el acento de la marca de la empresa. */
export function emailTemplateDesign(key: string, accent?: string | null): EmailDesign {
    const tpl = EMAIL_TEMPLATES.find((t) => t.key === key) ?? EMAIL_TEMPLATES[0]!;
    const design = JSON.parse(JSON.stringify(tpl.design)) as EmailDesign;
    if (accent && /^#[0-9a-fA-F]{6}$/.test(accent) && key !== 'payment' && key !== 'newsletter') {
        const old = design.theme.accent;
        design.theme.accent = accent;
        for (const b of design.blocks) if (b.background === old) b.background = accent;
    }
    return design;
}
