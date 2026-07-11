import { useMemo, useState } from 'react';
import {
    Check,
    Copy,
    ExternalLink,
    File as FileIcon,
    FileText,
    Image as ImageIcon,
    Mail,
    Paperclip,
    Phone,
    Play,
    StickyNote,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAttachments } from '@/hooks/useAttachments';
import { __ } from '@/lib/i18n';
import type { ResolvedV2Block } from '@/lib/crmTemplates';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

// ============================================================================
// FilesBlockView
// ============================================================================

interface FilesBlockViewProps {
    block: Extract<ResolvedV2Block, { type: 'files' }>;
    record: RecordEntity;
}

export function FilesBlockView({ block, record }: FilesBlockViewProps): JSX.Element {
    const { fileFields, title } = block.config;

    const items = useMemo(() => {
        const out: Array<{ field: FieldEntity; value: string | number }> = [];
        for (const f of fileFields) {
            // Valor numérico = attachment id del módulo de archivos (ADR-S16),
            // string = URL externa legacy. FileValueItem resuelve cada caso.
            const v = record.fields[f.slug];
            if (typeof v === 'string' && v.trim() !== '') out.push({ field: f, value: v });
            else if (typeof v === 'number' && v > 0) out.push({ field: f, value: v });
        }
        return out;
    }, [fileFields, record]);

    return (
        <Card title={title ?? __('Archivos')} icon={Paperclip}>
            {fileFields.length === 0 ? (
                <Empty>{__('No hay file fields. Editá el bloque para configurar.')}</Empty>
            ) : items.length === 0 ? (
                <Empty>{__('Sin archivos vinculados a este registro.')}</Empty>
            ) : (
                <ul className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    {items.map(({ field, value }) => (
                        <FileValueItem key={field.id} field={field} value={value} />
                    ))}
                </ul>
            )}
        </Card>
    );
}

/**
 * Render del valor de un file field:
 *  - numérico → attachment id del módulo de archivos (ADR-S16): se resuelve
 *    con `useAttachments` y se muestra `title` como link a la descarga
 *    (mientras carga, el id como texto);
 *  - string URL http(s) → link directo (valor legacy);
 *  - otro string → texto plano.
 */
function FileValueItem({
    field,
    value,
}: {
    field: FieldEntity;
    value: string | number;
}): JSX.Element {
    // Hook incondicional (rules-of-hooks): array vacío cuando no aplica
    // → la query queda disabled y no pega al backend.
    const attachmentId = typeof value === 'number' && value > 0 ? value : null;
    const attachments = useAttachments(attachmentId !== null ? [attachmentId] : []);
    const resolved = attachmentId !== null ? attachments.data?.get(attachmentId) ?? null : null;

    const href = resolved !== null
        ? resolved.url
        : typeof value === 'string' && /^https?:\/\//i.test(value.trim())
            ? value.trim()
            : null;
    const text = resolved !== null ? resolved.title : String(value);
    return (
        <li className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-p-2">
                <div className="imcrm-flex imcrm-h-16 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-bg-card">
                    <FileText className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" aria-hidden />
                </div>
                <span className="imcrm-text-[10px] imcrm-text-muted-foreground">
                    {field.label}
                </span>
                {href !== null ? (
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="imcrm-truncate imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    >
                        {text}
                    </a>
                ) : (
                    <span className="imcrm-truncate imcrm-text-xs imcrm-font-medium">
                        {text}
                    </span>
                )}
            </div>
        </li>
    );
}

// ============================================================================
// EmbedBlockView
// ============================================================================

interface EmbedBlockViewProps {
    block: Extract<ResolvedV2Block, { type: 'embed' }>;
    record: RecordEntity;
}

const EMBED_ALLOWLIST = [
    /^https:\/\/(www\.)?youtube\.com\/embed\//,
    /^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//,
    /^https:\/\/player\.vimeo\.com\/video\//,
    /^https:\/\/www\.google\.com\/maps\//,
    /^https:\/\/maps\.google\.com\//,
    /^https:\/\/(www\.)?loom\.com\/embed\//,
    /^https:\/\/(www\.)?figma\.com\/embed/,
    /^https:\/\/calendly\.com\//,
];

export function EmbedBlockView({ block, record }: EmbedBlockViewProps): JSX.Element {
    const { source, url, fieldSlug, title } = block.config;

    let resolvedUrl = '';
    if (source === 'literal' && url) {
        resolvedUrl = url.trim();
    } else if (source === 'field' && fieldSlug) {
        const v = record.fields[fieldSlug];
        if (typeof v === 'string') resolvedUrl = v.trim();
    }

    const allowed = EMBED_ALLOWLIST.some((re) => re.test(resolvedUrl));

    return (
        <Card title={title ?? __('Embed')} icon={Play}>
            {! resolvedUrl ? (
                <Empty>{__('Sin URL configurada.')}</Empty>
            ) : ! allowed ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-xs">
                    <p className="imcrm-text-warning">
                        {__('URL no permitida en embed (solo YouTube, Vimeo, Google Maps, Loom, Figma, Calendly).')}
                    </p>
                    <a
                        href={resolvedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="imcrm-truncate imcrm-text-primary hover:imcrm-underline"
                    >
                        {resolvedUrl}
                    </a>
                </div>
            ) : (
                <div className="imcrm-h-full imcrm-w-full imcrm-overflow-hidden imcrm-rounded">
                    <iframe
                        src={resolvedUrl}
                        title={title ?? __('Embed')}
                        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                        loading="lazy"
                        className="imcrm-h-full imcrm-w-full imcrm-border-0"
                    />
                </div>
            )}
        </Card>
    );
}

// ============================================================================
// ActionButtonView
// ============================================================================

interface ActionButtonViewProps {
    block: Extract<ResolvedV2Block, { type: 'action_button' }>;
    record: RecordEntity;
}

export function ActionButtonView({ block, record }: ActionButtonViewProps): JSX.Element {
    const { label, actionType, targetSource, target, targetField, variant = 'default' } = block.config;
    const toast = useToast();

    // Resolución del target: literal o desde un field. Si el field
    // tiene valor vacío, el botón queda disabled (mismo flujo que un
    // literal vacío).
    let resolvedTarget = '';
    if (targetSource === 'field' && targetField) {
        const v = record.fields[targetField.slug];
        if (typeof v === 'string') resolvedTarget = v;
        else if (typeof v === 'number') resolvedTarget = String(v);
    } else {
        resolvedTarget = target;
    }

    const handleClick = async (): Promise<void> => {
        if (actionType === 'copy') {
            try {
                await navigator.clipboard.writeText(resolvedTarget);
                toast.success(__('Copiado al portapapeles'));
            } catch {
                toast.error(__('No se pudo copiar'));
            }
        } else if (actionType === 'mailto') {
            window.location.href = `mailto:${resolvedTarget}`;
        } else if (actionType === 'tel') {
            window.location.href = `tel:${resolvedTarget.replace(/[^\d+]/g, '')}`;
        } else if (actionType === 'url') {
            const url = resolvedTarget.startsWith('http') ? resolvedTarget : `https://${resolvedTarget}`;
            window.open(url, '_blank', 'noopener');
        }
    };

    const Icon =
        actionType === 'mailto' ? Mail :
        actionType === 'tel' ? Phone :
        actionType === 'copy' ? Copy :
        ExternalLink;

    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
            <Button
                variant={variant}
                size="lg"
                className="imcrm-gap-2"
                onClick={() => void handleClick()}
                disabled={!resolvedTarget}
            >
                <Icon className="imcrm-h-4 imcrm-w-4" />
                {label || __('Acción')}
            </Button>
            {!resolvedTarget && (
                <p className="imcrm-mt-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {targetSource === 'field'
                        ? __('El campo no tiene valor en este registro.')
                        : __('Configurá el target en el bloque.')}
                </p>
            )}
        </section>
    );
}

// ============================================================================
// MarkdownBlockView
// ============================================================================

interface MarkdownBlockViewProps {
    block: Extract<ResolvedV2Block, { type: 'markdown' }>;
    record: RecordEntity;
    /** Si el bloque está en modo `source=field` y tenemos onChange,
     *  habilitamos edición inline (admin viendo el record). */
    values?: Record<string, unknown>;
    onChange?: (values: Record<string, unknown>) => void;
}

export function MarkdownBlockView({
    block,
    record,
    values,
    onChange,
}: MarkdownBlockViewProps): JSX.Element {
    // Resuelve content desde literal o desde un field. En modo field
    // + onChange disponible, leemos del `values` mutable (no del record
    // server-side) para que el edit inline se vea reflejado al instante.
    let raw = '';
    let editable: { fieldSlug: string; commit: (next: string) => void } | null = null;
    if (block.config.source === 'field' && block.config.field) {
        const slug = block.config.field.slug;
        const v = values?.[slug] ?? record.fields[slug];
        raw = typeof v === 'string' ? v : '';
        if (values && onChange) {
            editable = {
                fieldSlug: slug,
                commit: (next) => onChange({ ...values, [slug]: next }),
            };
        }
    } else {
        raw = block.config.content;
    }

    return (
        <Card title={block.config.title || __('Notas')} icon={StickyNote}>
            {editable ? (
                <MarkdownEditView raw={raw} onChange={editable.commit} />
            ) : (
                <div
                    className="imcrm-prose-sm imcrm-text-sm imcrm-leading-relaxed imcrm-text-foreground"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(raw) }}
                />
            )}
        </Card>
    );
}

/**
 * Markdown con toggle preview/edit. Default: preview rendereado.
 * Click "Editar" o sobre el área de preview vacío → textarea con
 * markdown plano editable. Mientras edita, se ve un toggle "Vista
 * previa" abajo a la derecha para alternar sin perder foco.
 */
function MarkdownEditView({
    raw,
    onChange,
}: {
    raw: string;
    onChange: (next: string) => void;
}): JSX.Element {
    const [mode, setMode] = useState<'preview' | 'edit'>(raw === '' ? 'edit' : 'preview');

    return (
        <div className="imcrm-relative imcrm-flex imcrm-h-full imcrm-flex-col">
            {mode === 'edit' ? (
                <textarea
                    value={raw}
                    onChange={(e) => onChange(e.target.value)}
                    autoFocus
                    placeholder={'# Título\n\n**bold** *italic* `code`\n\n- item\n- item'}
                    className="imcrm-flex-1 imcrm-w-full imcrm-resize-none imcrm-rounded imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-2 imcrm-font-mono imcrm-text-xs imcrm-leading-relaxed imcrm-text-foreground imcrm-outline-none focus:imcrm-border-primary focus:imcrm-ring-0 placeholder:imcrm-italic placeholder:imcrm-text-muted-foreground/70"
                />
            ) : (
                <button
                    type="button"
                    onClick={() => setMode('edit')}
                    title={__('Click para editar')}
                    className="imcrm-flex-1 imcrm-w-full imcrm-cursor-text imcrm-rounded imcrm-border imcrm-border-transparent imcrm-p-2 imcrm-text-left imcrm-text-sm imcrm-leading-relaxed imcrm-transition-colors hover:imcrm-border-border hover:imcrm-bg-accent/20"
                >
                    {raw === '' ? (
                        <span className="imcrm-italic imcrm-text-muted-foreground">
                            {__('Vacío. Click para escribir.')}
                        </span>
                    ) : (
                        <div
                            className="imcrm-prose-sm imcrm-text-foreground"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(raw) }}
                        />
                    )}
                </button>
            )}
            <button
                type="button"
                onClick={() => setMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
                className="imcrm-mt-1 imcrm-self-end imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-foreground"
            >
                {mode === 'edit' ? __('Vista previa') : __('Editar markdown')}
            </button>
        </div>
    );
}

/**
 * Mini-parser de markdown ligero. Soporta:
 *  - # heading 1, ## heading 2, ### heading 3
 *  - **bold**, *italic*
 *  - `inline code`
 *  - [text](url) links (target=_blank, rel=noopener)
 *  - listas con - o * o números
 *  - párrafos separados por línea en blanco
 *  - Auto-escape de HTML para evitar XSS
 *
 * NO soporta tablas, imágenes, blockquotes, etc. Si el user quiere
 * más, puede usar el bloque embed o crear un PR para extender.
 */
function renderMarkdown(input: string): string {
    if (! input) return '';
    let text = input;
    // 1. Escape HTML primero.
    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Inline: code, bold, italic, links.
    text = text
        .replace(/`([^`]+)`/g, '<code class="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-text-[12px]">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (_match: string, label: string, url: string) => {
                // Fase 16.A — fix bug S5: stored XSS si el url contiene
                // un scheme como `javascript:`. Whitelist: http, https,
                // mailto, tel, o relativo (sin `:` o `:` después de un
                // path char). Schemas no permitidos se neutralizan a #.
                const safeUrl = sanitizeMarkdownHref(url);
                return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="imcrm-text-primary hover:imcrm-underline">${label}</a>`;
            },
        );

    // 3. Block-level: headings y listas. Procesamos línea por línea.
    const lines = text.split('\n');
    const out: string[] = [];
    let inList: 'ul' | 'ol' | null = null;

    const closeList = (): void => {
        if (inList) {
            out.push(`</${inList}>`);
            inList = null;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line === '') {
            closeList();
            continue;
        }
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) {
            closeList();
            const level = h[1]!.length;
            const cls = level === 1
                ? 'imcrm-text-base imcrm-font-bold imcrm-mb-1'
                : level === 2
                    ? 'imcrm-text-sm imcrm-font-semibold imcrm-mb-1'
                    : 'imcrm-text-xs imcrm-font-semibold imcrm-mb-0.5 imcrm-uppercase imcrm-tracking-wide';
            out.push(`<h${level} class="${cls}">${h[2]}</h${level}>`);
            continue;
        }
        const ulMatch = /^[-*]\s+(.*)$/.exec(line);
        if (ulMatch) {
            if (inList !== 'ul') {
                closeList();
                out.push('<ul class="imcrm-ml-4 imcrm-list-disc imcrm-flex imcrm-flex-col imcrm-gap-0.5">');
                inList = 'ul';
            }
            out.push(`<li>${ulMatch[1]}</li>`);
            continue;
        }
        const olMatch = /^\d+\.\s+(.*)$/.exec(line);
        if (olMatch) {
            if (inList !== 'ol') {
                closeList();
                out.push('<ol class="imcrm-ml-4 imcrm-list-decimal imcrm-flex imcrm-flex-col imcrm-gap-0.5">');
                inList = 'ol';
            }
            out.push(`<li>${olMatch[1]}</li>`);
            continue;
        }
        // Párrafo normal.
        closeList();
        out.push(`<p>${line}</p>`);
    }
    closeList();
    return out.join('\n');
}

// ============================================================================
// Shared helpers
// ============================================================================

function Card({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon: typeof FileIcon;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
            <header className="imcrm-mb-3 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                {title}
            </header>
            <div className="imcrm-flex-1 imcrm-overflow-y-auto">{children}</div>
        </section>
    );
}

/**
 * Whitelist de schemes para hrefs del markdown renderer (Fase 16.A).
 *
 * Acepta: http, https, mailto, tel, o relativo (sin `:` antes del
 * primer `/`, `#`, `?`, o sin `:` en absoluto). Rechaza: javascript,
 * data, vbscript, file, blob, y cualquier otro scheme — devuelve
 * `#` (link no-op) para que el output siga siendo válido HTML pero
 * el click no ejecute código.
 *
 * Test cases que neutraliza:
 *   sanitizeMarkdownHref('javascript:alert(1)') → '#'
 *   sanitizeMarkdownHref('data:text/html,<script>...') → '#'
 *   sanitizeMarkdownHref('https://example.com') → 'https://example.com'
 *   sanitizeMarkdownHref('/contacto') → '/contacto'
 *   sanitizeMarkdownHref('mailto:foo@bar.com') → 'mailto:foo@bar.com'
 *
 * También escapamos `"` para que no rompa el atributo `href="..."`
 * del template — un `[x](https://a.com"onmouseover=alert)` no
 * inyecta atributos.
 */
function sanitizeMarkdownHref(url: string): string {
    const trimmed = url.trim();
    if (! trimmed) return '#';
    // Relativo: si NO contiene `:` antes de un `/`, `?`, `#`, es safe.
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
        return escapeHtmlAttr(trimmed);
    }
    // Si hay `:` pero un `/`, `?`, `#` aparece antes, también es relativo
    // (ej. `path/with:colon` o `?query=x:y`).
    const slashIdx = trimmed.indexOf('/');
    const queryIdx = trimmed.indexOf('?');
    const hashIdx = trimmed.indexOf('#');
    const firstPathChar = Math.min(
        slashIdx === -1 ? Infinity : slashIdx,
        queryIdx === -1 ? Infinity : queryIdx,
        hashIdx === -1 ? Infinity : hashIdx,
    );
    if (firstPathChar < colonIdx) {
        return escapeHtmlAttr(trimmed);
    }
    // Absoluto con scheme. Whitelist.
    const scheme = trimmed.slice(0, colonIdx).toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') {
        return escapeHtmlAttr(trimmed);
    }
    return '#';
}

function escapeHtmlAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
    return <p className="imcrm-text-xs imcrm-text-muted-foreground">{children}</p>;
}

// Force usage to satisfy linter if some icons aren't reached.
void ImageIcon;
void Check;
