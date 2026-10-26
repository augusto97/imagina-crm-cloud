import {
    HEADER_FORMAT_LABEL,
    WHATSAPP_STATUS_OPTIONS,
    WHATSAPP_TEMPLATE_CATEGORY_LABEL,
    WHATSAPP_TEMPLATE_STATUS_LABEL,
    renderWhatsappTemplate,
    whatsappTemplateShape,
    type WhatsappStatus,
    type WhatsappTemplate,
} from '@imagina-base/shared';
import { FileText, Image as ImageIcon, MapPin, Video } from 'lucide-react';
import { Fragment } from 'react';

import { Badge } from '@/components/ui/badge';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Piezas chicas de WhatsApp oficial (D3): el chip del estado del envío —el
 * MISMO color que la opción de la columna «Estado del último envío»—, el
 * estado de una plantilla en Meta y la burbuja de vista previa.
 */

export function WhatsappStatusChip({ status, className }: { status: WhatsappStatus; className?: string }): JSX.Element {
    const opt = WHATSAPP_STATUS_OPTIONS[status];
    return (
        <span
            data-testid="imcrm-whatsapp-status"
            data-status={status}
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-white',
                className,
            )}
            style={{ backgroundColor: opt.color }}
        >
            {opt.label}
        </span>
    );
}

export function TemplateStatusBadge({ status }: { status: string }): JSX.Element {
    const label = WHATSAPP_TEMPLATE_STATUS_LABEL[status] ?? status;
    const variant = status === 'APPROVED' ? 'success' : status === 'REJECTED' || status === 'DISABLED' ? 'destructive' : status === 'PAUSED' ? 'warning' : 'secondary';
    return <Badge variant={variant}>{label}</Badge>;
}

const REJECTED_REASON: Record<string, string> = {
    PROMOTIONAL: 'tiene contenido promocional en una categoría que no lo permite',
    INVALID_FORMAT: 'el formato no es válido (variables mal puestas o seguidas)',
    ABUSIVE_CONTENT: 'Meta lo consideró contenido abusivo',
    TAG_CONTENT_MISMATCH: 'el contenido no corresponde con la categoría elegida',
    SCAM: 'Meta lo consideró posible fraude',
};

/** El motivo de rechazo de Meta en lenguaje claro (con el código original). */
export function rejectedReasonText(reason: string): string {
    const text = REJECTED_REASON[reason];
    return text ? `${__(text)} (${reason})` : reason;
}

export function templateCategoryLabel(category: string): string {
    return WHATSAPP_TEMPLATE_CATEGORY_LABEL[category] ?? category;
}

/** «recordatorio_pago · Español (es)». */
export function templateOptionLabel(t: Pick<WhatsappTemplate, 'name' | 'language'>): string {
    return `${t.name} · ${t.language}`;
}

const PLACEHOLDER = /(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g;
const IS_PLACEHOLDER = /^\{\{\s*[A-Za-z0-9_]+\s*\}\}$/;

/** El texto con las variables que faltan resaltadas. */
function Highlighted({ text }: { text: string }): JSX.Element {
    const parts = text.split(PLACEHOLDER);
    return (
        <>
            {parts.map((p, i) =>
                IS_PLACEHOLDER.test(p) ? (
                    <span key={i} className="imcrm-rounded imcrm-bg-amber-200/70 imcrm-px-0.5 imcrm-font-mono imcrm-text-[0.85em] imcrm-text-amber-950 dark:imcrm-bg-amber-400/25 dark:imcrm-text-amber-100">
                        {p}
                    </span>
                ) : (
                    <Fragment key={i}>{p}</Fragment>
                ),
            )}
        </>
    );
}

const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText, LOCATION: MapPin } as const;

/**
 * La plantilla como la verá el contacto, en una burbuja de WhatsApp. Las
 * variables sin completar quedan resaltadas (`{{1}}`); el encabezado con
 * imagen, video o documento muestra el enlace que se mandará.
 */
export function WhatsappBubble({
    template,
    variables,
    headerMedia,
    className,
}: {
    template: Pick<WhatsappTemplate, 'components' | 'parameter_format'>;
    variables: Record<string, string>;
    headerMedia?: string;
    className?: string;
}): JSX.Element {
    const shape = whatsappTemplateShape(template.components, template.parameter_format);
    const r = renderWhatsappTemplate(template.components, template.parameter_format, variables);
    const media = shape.header && shape.header.format !== 'TEXT' ? shape.header.format : null;
    const Icon = media ? (MEDIA_ICON[media as keyof typeof MEDIA_ICON] ?? FileText) : null;
    return (
        <div className={cn('imcrm-rounded-xl imcrm-bg-[#e5ddd5] imcrm-p-3 dark:imcrm-bg-[#0b141a]', className)} data-testid="imcrm-whatsapp-bubble">
            <div className="imcrm-max-w-[22rem] imcrm-rounded-lg imcrm-rounded-tl-none imcrm-bg-white imcrm-p-2 imcrm-text-[13px] imcrm-leading-snug imcrm-text-[#111b21] imcrm-shadow-sm dark:imcrm-bg-[#202c33] dark:imcrm-text-[#e9edef]">
                {Icon && (
                    <div className="imcrm-mb-1.5 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-black/5 imcrm-px-2 imcrm-py-2 imcrm-text-xs dark:imcrm-bg-white/10">
                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-opacity-70" />
                        <span className="imcrm-min-w-0 imcrm-truncate">
                            {headerMedia && headerMedia.trim() !== '' ? headerMedia : `${HEADER_FORMAT_LABEL[media!] ?? __('Adjunto')} — ${__('falta el enlace')}`}
                        </span>
                    </div>
                )}
                {!media && r.header && <p className="imcrm-mb-1 imcrm-font-semibold"><Highlighted text={r.header} /></p>}
                <p className="imcrm-whitespace-pre-wrap imcrm-break-words">
                    <Highlighted text={r.body} />
                </p>
                {r.footer && <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-black/45 dark:imcrm-text-white/45">{r.footer}</p>}
            </div>
            {r.buttons.length > 0 && (
                <div className="imcrm-mt-1 imcrm-flex imcrm-max-w-[22rem] imcrm-flex-col imcrm-gap-1">
                    {r.buttons.map((b, i) => (
                        <span
                            key={i}
                            className="imcrm-rounded-lg imcrm-bg-white imcrm-py-1.5 imcrm-text-center imcrm-text-[13px] imcrm-font-medium imcrm-text-[#027eb5] imcrm-shadow-sm dark:imcrm-bg-[#202c33] dark:imcrm-text-[#53bdeb]"
                        >
                            {b}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
