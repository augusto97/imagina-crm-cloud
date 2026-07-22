import { adminImageSrc } from '@/admin/template-editor-core/ImageBlockForm';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

/**
 * Widgets de CONTENIDO del dashboard (v0.1.98) — no consumen datos: el
 * dashboard se estructura como una página (títulos de sección, texto,
 * imagen/logo, separadores y espacio). La apariencia (fondo, texto,
 * tipografía…) la aporta la capa de estilo del card (`config.style`,
 * misma que el editor de plantillas).
 */

export function HeadingWidget({ widget }: { widget: WidgetSpec }): JSX.Element {
    const sub = typeof widget.config.subtitle === 'string' ? widget.config.subtitle : '';
    return (
        <div className="imcrm-drag-handle imcrm-flex imcrm-h-full imcrm-cursor-grab imcrm-select-none imcrm-flex-col imcrm-justify-center active:imcrm-cursor-grabbing">
            <h2 className="imcrm-truncate imcrm-text-lg imcrm-font-semibold imcrm-leading-tight">
                {widget.title || __('Sección')}
            </h2>
            {sub !== '' && (
                <p className="imcrm-mt-0.5 imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{sub}</p>
            )}
        </div>
    );
}

export function TextWidget({ widget }: { widget: WidgetSpec }): JSX.Element {
    const text = typeof widget.config.text === 'string' ? widget.config.text : '';
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto">
            {widget.title !== '' && (
                <h3 className="imcrm-drag-handle imcrm-shrink-0 imcrm-cursor-grab imcrm-select-none imcrm-text-[13px] imcrm-font-semibold active:imcrm-cursor-grabbing">
                    {widget.title}
                </h3>
            )}
            <div className="imcrm-whitespace-pre-wrap imcrm-text-[13px] imcrm-leading-relaxed">
                {text || <span className="imcrm-text-muted-foreground">{__('Escribí el texto en la configuración del bloque.')}</span>}
            </div>
        </div>
    );
}

export function ImageWidget({ widget }: { widget: WidgetSpec }): JSX.Element {
    const cfg = widget.config as Record<string, unknown>;
    const src = adminImageSrc(cfg);
    if (src === undefined) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-text-xs imcrm-text-muted-foreground">
                {__('Elegí una imagen en la configuración del bloque.')}
            </div>
        );
    }
    const alt = typeof cfg.alt === 'string' ? cfg.alt : '';
    const fit = cfg.fit === 'contain' ? ('contain' as const) : ('cover' as const);
    const linkUrl = typeof cfg.link_url === 'string' && cfg.link_url !== '' ? cfg.link_url : undefined;
    // La imagen llena el card — el usuario la dimensiona por resize del grid.
    const img = (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }}
        />
    );
    return (
        <div className="imcrm-h-full imcrm-min-h-0 imcrm-overflow-hidden imcrm-rounded-md">
            {linkUrl !== undefined ? (
                <a href={linkUrl} target="_blank" rel="noreferrer" className="imcrm-block imcrm-h-full">
                    {img}
                </a>
            ) : img}
        </div>
    );
}

export function DividerWidget(): JSX.Element {
    return (
        <div className="imcrm-drag-handle imcrm-flex imcrm-h-full imcrm-cursor-grab imcrm-items-center active:imcrm-cursor-grabbing">
            <hr className="imcrm-w-full imcrm-border-border" />
        </div>
    );
}

export function SpacerWidget(): JSX.Element {
    return <div className="imcrm-drag-handle imcrm-h-full imcrm-cursor-grab active:imcrm-cursor-grabbing" />;
}
