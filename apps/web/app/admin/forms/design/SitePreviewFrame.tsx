import type { ReactNode } from 'react';

import { __ } from '@/lib/i18n';

/**
 * v0.1.369 — La vista previa «Insertado en tu sitio»: el formulario dentro de
 * una página web de ejemplo (siempre clara, como la mayoría de los sitios), con
 * el espacio que le da la página marcado con una línea punteada. Así se ve si
 * queda «con su tarjeta» o «sin marco», ocupando ese espacio de borde a borde.
 * Los colores son fijos a propósito: es un sitio de ejemplo, no la app.
 */
export function SitePreviewFrame({ bare, children }: { bare: boolean; children: ReactNode }): JSX.Element {
    return (
        <div
            className="imcrm-flex imcrm-h-full imcrm-w-full imcrm-max-w-[980px] imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-shadow-sm"
            style={{ background: '#ffffff', color: '#1f2937' }}
            data-testid="form-preview-site"
            data-bare={bare ? '' : undefined}
        >
            {/* La barra del navegador. */}
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2" style={{ background: '#f1f3f5', borderBottom: '1px solid #e5e7eb' }} aria-hidden="true">
                <span className="imcrm-flex imcrm-gap-1">
                    <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full" style={{ background: '#f87171' }} />
                    <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full" style={{ background: '#fbbf24' }} />
                    <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full" style={{ background: '#34d399' }} />
                </span>
                <span className="imcrm-ml-1 imcrm-truncate imcrm-rounded imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px]" style={{ background: '#ffffff', color: '#6b7280' }}>
                    tusitio.com/contacto
                </span>
            </div>
            {/* La página de ejemplo. */}
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-5 imcrm-overflow-hidden imcrm-p-5 md:imcrm-flex-row">
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-2 md:imcrm-w-[38%]" aria-hidden="true">
                    <span className="imcrm-text-lg imcrm-font-bold" style={{ color: '#111827' }}>
                        {__('Contáctanos')}
                    </span>
                    <span className="imcrm-text-xs imcrm-leading-relaxed" style={{ color: '#6b7280' }}>
                        {__('Así se ve tu formulario dentro de una página de tu sitio. La línea punteada es el espacio que le da la página.')}
                    </span>
                    <span className="imcrm-mt-2 imcrm-h-2 imcrm-w-4/5 imcrm-rounded" style={{ background: '#e5e7eb' }} />
                    <span className="imcrm-h-2 imcrm-w-3/5 imcrm-rounded" style={{ background: '#e5e7eb' }} />
                    <span className="imcrm-h-2 imcrm-w-2/3 imcrm-rounded" style={{ background: '#e5e7eb' }} />
                </div>
                <div className="imcrm-flex imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide" style={{ color: '#0369a1' }} aria-hidden="true">
                        {bare ? __('Sin marco: ocupa todo el espacio') : __('Con su tarjeta')}
                    </span>
                    <div className="imcrm-min-h-0 imcrm-flex-1" style={{ outline: '1px dashed #38bdf8', outlineOffset: 0 }}>
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
