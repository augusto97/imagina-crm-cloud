import { Node, mergeAttributes } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Link } from 'react-router';
import { AtSign, Download, FileText, Hash, ImageOff } from 'lucide-react';

import { useAttachments } from '@/hooks/useAttachments';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Bloques "vivos" del editor de descripción (v0.1.134).
 *
 * A diferencia del texto, estos nodos apuntan a ENTIDADES de la app por ID:
 * una persona, un registro, un archivo. La etiqueta que se ve es una copia
 * para poder renderizar sin pedir nada; la verdad es el id (misma regla que
 * las claves `f{field_id}`: renombrar no rompe el vínculo).
 *
 * Cada tipo de acá tiene su entrada en la whitelist de `sanitizeRichDoc`
 * (packages/shared) — si no, el backend lo descartaría al guardar.
 */

// ——— Mención de persona ————————————————————————————————————————————————

export const MentionUser = Node.create({
    name: 'mentionUser',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            id: { default: null },
            label: { default: '' },
        };
    },
    parseHTML() {
        return [{ tag: 'span[data-imcrm-mention-user]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes({ 'data-imcrm-mention-user': '' }, HTMLAttributes)];
    },
    addNodeView() {
        return ReactNodeViewRenderer(MentionUserView);
    },
});

function MentionUserView({ node }: NodeViewProps): JSX.Element {
    const label = String(node.attrs.label ?? '') || __('Alguien');
    return (
        <NodeViewWrapper as="span" className="imcrm-inline" data-imcrm-mention-user="">
            <span
                className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded imcrm-bg-primary/10 imcrm-px-1 imcrm-py-0.5 imcrm-text-[0.92em] imcrm-font-medium imcrm-text-primary"
                title={label}
            >
                <AtSign className="imcrm-h-3 imcrm-w-3" aria-hidden />
                {label}
            </span>
        </NodeViewWrapper>
    );
}

// ——— Mención de registro ——————————————————————————————————————————————

export const MentionRecord = Node.create({
    name: 'mentionRecord',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            id: { default: null },
            listSlug: { default: '' },
            label: { default: '' },
        };
    },
    parseHTML() {
        return [{ tag: 'span[data-imcrm-mention-record]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes({ 'data-imcrm-mention-record': '' }, HTMLAttributes)];
    },
    addNodeView() {
        return ReactNodeViewRenderer(MentionRecordView);
    },
});

function MentionRecordView({ node }: NodeViewProps): JSX.Element {
    const id = Number(node.attrs.id);
    const slug = String(node.attrs.listSlug ?? '');
    const label = String(node.attrs.label ?? '') || `#${id}`;
    const to = slug === '' ? null : `/lists/${slug}/records/${id}`;
    const chip = (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-text-[0.92em] imcrm-font-medium imcrm-text-foreground">
            <Hash className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" aria-hidden />
            {label}
        </span>
    );
    return (
        <NodeViewWrapper as="span" className="imcrm-inline" data-imcrm-mention-record="">
            {to === null ? (
                chip
            ) : (
                <Link to={to} className="imcrm-no-underline hover:imcrm-opacity-80" contentEditable={false}>
                    {chip}
                </Link>
            )}
        </NodeViewWrapper>
    );
}

// ——— Imagen ————————————————————————————————————————————————————————————

export const ImageBlock = Node.create({
    name: 'imageBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            /** Archivo del módulo propio (ADR-S16). */
            fileId: { default: null },
            /** …o una URL externa, si la persona pegó un enlace. */
            src: { default: null },
            alt: { default: '' },
            width: { default: null },
        };
    },
    parseHTML() {
        return [{ tag: 'div[data-imcrm-image-block]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-imcrm-image-block': '' }, HTMLAttributes)];
    },
    addNodeView() {
        return ReactNodeViewRenderer(ImageBlockView);
    },
});

function ImageBlockView({ node }: NodeViewProps): JSX.Element {
    const fileId = Number(node.attrs.fileId) || 0;
    const external = node.attrs.src === null ? '' : String(node.attrs.src);
    const alt = String(node.attrs.alt ?? '');
    const width = node.attrs.width === null ? undefined : Number(node.attrs.width);
    const { data } = useAttachments(fileId > 0 ? [fileId] : []);
    const resolved = fileId > 0 ? data?.get(fileId) : undefined;
    const src = external !== '' ? external : (resolved?.url ?? '');

    return (
        <NodeViewWrapper className="imcrm-my-3" data-imcrm-image-block="" data-drag-handle>
            {src === '' ? (
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-6 imcrm-text-xs imcrm-text-muted-foreground">
                    <ImageOff className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {fileId > 0 ? __('Cargando la imagen…') : __('Imagen sin origen')}
                </span>
            ) : (
                <img
                    src={src}
                    alt={alt}
                    style={width === undefined ? undefined : { width: `${width}px` }}
                    className="imcrm-max-w-full imcrm-rounded-md imcrm-border imcrm-border-border"
                />
            )}
        </NodeViewWrapper>
    );
}

// ——— Adjunto ———————————————————————————————————————————————————————————

export const FileBlock = Node.create({
    name: 'fileBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            fileId: { default: null },
            name: { default: '' },
            size: { default: null },
        };
    },
    parseHTML() {
        return [{ tag: 'div[data-imcrm-file-block]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-imcrm-file-block': '' }, HTMLAttributes)];
    },
    addNodeView() {
        return ReactNodeViewRenderer(FileBlockView);
    },
});

function FileBlockView({ node }: NodeViewProps): JSX.Element {
    const fileId = Number(node.attrs.fileId) || 0;
    const name = String(node.attrs.name ?? '') || __('Archivo');
    const size = node.attrs.size === null ? null : Number(node.attrs.size);
    const { data } = useAttachments(fileId > 0 ? [fileId] : []);
    const resolved = fileId > 0 ? data?.get(fileId) : undefined;

    return (
        <NodeViewWrapper className="imcrm-my-2" data-imcrm-file-block="" data-drag-handle>
            <a
                href={resolved?.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                contentEditable={false}
                className={cn(
                    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-no-underline',
                    'hover:imcrm-bg-accent/50',
                )}
            >
                <FileText className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-text-foreground">
                    {resolved?.title ?? name}
                </span>
                {size !== null && size > 0 && (
                    <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {formatSize(size)}
                    </span>
                )}
                <Download className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            </a>
        </NodeViewWrapper>
    );
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
