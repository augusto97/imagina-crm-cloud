import { Highlight } from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import type { AnyExtension } from '@tiptap/react';

import { FileBlock, ImageBlock, MentionRecord, MentionUser } from './nodes';

import { __ } from '@/lib/i18n';

/**
 * Extensiones del editor de descripción (v0.1.133).
 *
 * El conjunto es EXACTAMENTE el que la whitelist de `sanitizeRichDoc`
 * (packages/shared) sabe persistir: si acá se agrega un nodo nuevo sin
 * agregarlo allá, el backend lo descartaría en silencio al guardar y el
 * usuario vería desaparecer su contenido al recargar. Los dos lados se tocan
 * juntos, siempre.
 */
export function descriptionExtensions(placeholder: string): AnyExtension[] {
    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3, 4] },
            link: {
                openOnClick: false,
                autolink: true,
                // Los esquemas peligrosos igual los corta el backend, pero
                // mejor que nunca lleguen a existir en el documento.
                protocols: ['http', 'https', 'mailto', 'tel'],
                HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
            },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TextStyle,
        Color,
        BackgroundColor,
        Highlight.configure({ multicolor: true }),
        TableKit.configure({ table: { resizable: true } }),
        // Bloques "vivos" (v0.1.134): mención de persona/registro, imagen y
        // adjunto del módulo de archivos.
        MentionUser,
        MentionRecord,
        ImageBlock,
        FileBlock,
        Placeholder.configure({
            placeholder: ({ node }) =>
                node.type.name === 'heading' ? __('Título') : placeholder,
        }),
    ];
}

/** Paleta de color de texto del menú flotante (misma escala que el tema). */
export const TEXT_COLORS: Array<{ label: string; value: string | null }> = [
    { label: 'Predeterminado', value: null },
    { label: 'Rojo', value: '#dc2626' },
    { label: 'Naranja', value: '#ea580c' },
    { label: 'Amarillo', value: '#ca8a04' },
    { label: 'Verde', value: '#16a34a' },
    { label: 'Azul', value: '#2563eb' },
    { label: 'Violeta', value: '#7c3aed' },
    { label: 'Rosa', value: '#db2777' },
    { label: 'Gris', value: '#6b7280' },
];

/** Resaltados (fondo del texto). */
export const HIGHLIGHT_COLORS: Array<{ label: string; value: string | null }> = [
    { label: 'Quitar resaltado', value: null },
    { label: 'Rojo', value: '#fecaca' },
    { label: 'Naranja', value: '#fed7aa' },
    { label: 'Amarillo', value: '#fef08a' },
    { label: 'Verde', value: '#bbf7d0' },
    { label: 'Azul', value: '#bfdbfe' },
    { label: 'Violeta', value: '#ddd6fe' },
    { label: 'Rosa', value: '#fbcfe8' },
    { label: 'Gris', value: '#e5e7eb' },
];
