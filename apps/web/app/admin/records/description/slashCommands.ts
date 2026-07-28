import {
    AtSign,
    Code2,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListChecks,
    ListOrdered,
    Minus,
    Hash,
    Image,
    Paperclip,
    Quote,
    Table as TableIcon,
    Type,
    type LucideIcon,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';

import { __ } from '@/lib/i18n';

export interface SlashCommand {
    id: string;
    /**
     * Comandos que NO se resuelven con el editor solo: necesitan pedir algo
     * antes (subir un archivo, elegir una persona o un registro). El editor
     * los intercepta y abre lo que corresponda.
     */
    action?: 'image' | 'file' | 'mentionUser' | 'mentionRecord';
    /** Grupo del menú (el orden de aparición lo da el array). */
    group: string;
    label: string;
    hint: string;
    icon: LucideIcon;
    /** Palabras extra para la búsqueda (además del label). */
    keywords: string;
    run: (editor: Editor) => void;
}

/**
 * Comandos del menú `/` del editor de descripción (v0.1.133).
 *
 * Sólo entra lo que el documento sabe guardar de verdad: cada comando de esta
 * lista tiene su nodo en las extensiones del editor Y en la whitelist del
 * backend. Los bloques "vivos" del menú de ClickUp (menciones, subtareas,
 * embeds, botones) llegan en la fase 2 — ponerlos apagados sería peor que no
 * ponerlos.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
    {
        id: 'paragraph',
        group: __('Texto'),
        label: __('Texto normal'),
        hint: __('Un párrafo sin formato'),
        icon: Type,
        keywords: 'parrafo texto normal p',
        run: (e) => e.chain().focus().setParagraph().run(),
    },
    {
        id: 'h1',
        group: __('Texto'),
        label: __('Título 1'),
        hint: __('Título de sección grande'),
        icon: Heading1,
        keywords: 'titulo heading h1 encabezado',
        run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
        id: 'h2',
        group: __('Texto'),
        label: __('Título 2'),
        hint: __('Título mediano'),
        icon: Heading2,
        keywords: 'titulo heading h2 encabezado',
        run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
        id: 'h3',
        group: __('Texto'),
        label: __('Título 3'),
        hint: __('Título pequeño'),
        icon: Heading3,
        keywords: 'titulo heading h3 encabezado',
        run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
        id: 'bullet',
        group: __('Listas'),
        label: __('Lista con viñetas'),
        hint: __('Una lista simple'),
        icon: List,
        keywords: 'lista vinetas bullet ul puntos',
        run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
        id: 'ordered',
        group: __('Listas'),
        label: __('Lista numerada'),
        hint: __('Una lista con orden'),
        icon: ListOrdered,
        keywords: 'lista numerada ol numeros',
        run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
        id: 'task',
        group: __('Listas'),
        label: __('Lista de control'),
        hint: __('Casillas para marcar'),
        icon: ListChecks,
        keywords: 'checklist tareas control casillas todo',
        run: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
        id: 'quote',
        group: __('Bloques'),
        label: __('Cita'),
        hint: __('Destacar un texto citado'),
        icon: Quote,
        keywords: 'cita quote blockquote',
        run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
        id: 'code',
        group: __('Bloques'),
        label: __('Bloque de código'),
        hint: __('Código con ancho fijo'),
        icon: Code2,
        keywords: 'codigo code snippet pre',
        run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
        id: 'divider',
        group: __('Bloques'),
        label: __('Divisor'),
        hint: __('Una línea separadora'),
        icon: Minus,
        keywords: 'divisor separador linea hr regla',
        run: (e) => e.chain().focus().setHorizontalRule().run(),
    },
    {
        id: 'table',
        group: __('Bloques'),
        label: __('Tabla'),
        hint: __('Una tabla de 3×3 con cabecera'),
        icon: TableIcon,
        keywords: 'tabla table grilla',
        run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
];

/** Bloques "vivos" (v0.1.134): apuntan a entidades de la app, no a texto. */
SLASH_COMMANDS.push(
    {
        id: 'mention-user',
        group: __('Menciones'),
        label: __('Mencionar persona'),
        hint: __('Le avisa en su campana'),
        icon: AtSign,
        keywords: 'mencionar persona usuario arroba equipo notificar',
        action: 'mentionUser',
        run: () => {},
    },
    {
        id: 'mention-record',
        group: __('Menciones'),
        label: __('Mencionar registro'),
        hint: __('Enlaza a otro registro'),
        icon: Hash,
        keywords: 'mencionar registro tarea vincular enlazar referencia',
        action: 'mentionRecord',
        run: () => {},
    },
    {
        id: 'image',
        group: __('Archivos'),
        label: __('Imagen'),
        hint: __('Sube una imagen'),
        icon: Image,
        keywords: 'imagen foto captura subir jpg png',
        action: 'image',
        run: () => {},
    },
    {
        id: 'file',
        group: __('Archivos'),
        label: __('Adjunto'),
        hint: __('Sube un archivo'),
        icon: Paperclip,
        keywords: 'adjunto archivo documento pdf subir',
        action: 'file',
        run: () => {},
    },
);

/** Normaliza para buscar sin acentos ni mayúsculas. */
export function normalizeQuery(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

export function filterCommands(query: string): SlashCommand[] {
    const q = normalizeQuery(query.trim());
    if (q === '') return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((c) =>
        normalizeQuery(`${c.label} ${c.keywords} ${c.group}`).includes(q),
    );
}
