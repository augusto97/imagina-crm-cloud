import { Calendar, Check, Paperclip, Star } from 'lucide-react';

import { FieldButtonView } from '@/components/fields/FieldButtonView';
import { chipSoftStyle } from '@/components/ui/color-picker';
import { __ } from '@/lib/i18n';
import { formatDateStr, formatDateTime, formatNumber } from '@/lib/tenantFormat';
import type { FieldTypeSlug } from '@/types/field';

/**
 * Vista previa de un tipo de campo (v0.1.160).
 *
 * Al elegir el tipo de una columna nueva, la duda real no es qué dice el
 * nombre sino **cómo se va a ver** — por eso ClickUp muestra una maqueta al
 * lado de la descripción. Esto dibuja la celda tal como quedaría, con datos
 * de mentira: no consulta nada ni depende de la lista.
 */
export function FieldTypePreview({ type }: { type: FieldTypeSlug }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-[64px] imcrm-flex-col imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-2.5">
            {renderPreview(type)}
        </div>
    );
}

function Row({ children }: { children: React.ReactNode }): JSX.Element {
    return <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">{children}</div>;
}

function Chip({ label, color }: { label: string; color: string }): JSX.Element {
    return (
        <span
            className="imcrm-inline-flex imcrm-items-center imcrm-rounded-md imcrm-border imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium"
            style={chipSoftStyle(color as never) ?? undefined}
        >
            {label}
        </span>
    );
}

function Line({ w = '70%' }: { w?: string }): JSX.Element {
    return <span className="imcrm-block imcrm-h-2 imcrm-rounded imcrm-bg-muted" style={{ width: w }} />;
}

function renderPreview(type: FieldTypeSlug): React.ReactNode {
    switch (type) {
        case 'text':
            return <Row><span className="imcrm-text-foreground">Acme S.A.</span></Row>;
        case 'long_text':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Line w="90%" />
                    <Line w="75%" />
                    <Line w="45%" />
                </div>
            );
        case 'number':
            // v0.1.286 — los ejemplos con el formato regional de la empresa
            // (antes «1.250» fijo: en una empresa con coma de miles se leía
            // como uno coma veinticinco).
            return <Row><span className="imcrm-tabular-nums">{formatNumber(1250)}</span></Row>;
        case 'currency':
            return <Row><span className="imcrm-tabular-nums">$ {formatNumber(1250, { minFrac: 2, maxFrac: 2 })}</span></Row>;
        case 'select':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Chip label={__('Activo')} color="emerald" />
                    <Chip label={__('En pausa')} color="amber" />
                </div>
            );
        case 'approval':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Chip label={__('Pendiente')} color="amber" />
                    <Chip label={__('Aprobada')} color="green" />
                </div>
            );
        case 'multi_select':
            return (
                <Row>
                    <Chip label="VIP" color="violet" />
                    <Chip label={__('Promo')} color="sky" />
                </Row>
            );
        case 'date':
            return (
                <Row>
                    <Calendar className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                    <span>{formatDateStr('2026-12-31')}</span>
                </Row>
            );
        case 'datetime':
            return (
                <Row>
                    <Calendar className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                    <span>{formatDateTime(new Date(2026, 11, 31, 14, 30))}</span>
                </Row>
            );
        case 'checkbox':
            return (
                <Row>
                    <span className="imcrm-flex imcrm-h-3.5 imcrm-w-3.5 imcrm-items-center imcrm-justify-center imcrm-rounded-sm imcrm-bg-primary imcrm-text-primary-foreground">
                        <Check className="imcrm-h-2.5 imcrm-w-2.5" aria-hidden />
                    </span>
                    <span className="imcrm-text-muted-foreground">{__('Sí')}</span>
                </Row>
            );
        case 'email':
            return <Row><span className="imcrm-text-primary">ana@empresa.com</span></Row>;
        case 'url':
            return <Row><span className="imcrm-text-primary">empresa.com</span></Row>;
        case 'phone':
            return (
                <Row>
                    <span aria-hidden>🇨🇴</span>
                    <span className="imcrm-tabular-nums">300 111 2233</span>
                </Row>
            );
        case 'rating':
            return (
                <Row>
                    {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                            key={n}
                            className={n <= 4 ? 'imcrm-h-3.5 imcrm-w-3.5 imcrm-text-amber-500' : 'imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground/40'}
                            fill={n <= 4 ? 'currentColor' : 'none'}
                            aria-hidden
                        />
                    ))}
                </Row>
            );
        case 'percent':
            return (
                <Row>
                    <span className="imcrm-h-1.5 imcrm-w-16 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                        <span className="imcrm-block imcrm-h-full imcrm-rounded-full imcrm-bg-primary" style={{ width: '65%' }} />
                    </span>
                    <span className="imcrm-text-muted-foreground">65%</span>
                </Row>
            );
        case 'duration':
            return <Row><span className="imcrm-tabular-nums">1h 30m</span></Row>;
        case 'checklist_progress':
            return (
                <Row>
                    <span className="imcrm-h-1.5 imcrm-w-16 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                        <span className="imcrm-block imcrm-h-full imcrm-rounded-full imcrm-bg-emerald-500" style={{ width: '38%' }} />
                    </span>
                    <span className="imcrm-text-muted-foreground">3/8</span>
                </Row>
            );
        case 'time_tracked':
            return (
                <Row>
                    <span className="imcrm-text-primary" aria-hidden>⏱</span>
                    <span className="imcrm-tabular-nums">12h 30m</span>
                </Row>
            );
        case 'user':
            return (
                <Row>
                    <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[9px] imcrm-font-medium">
                        AG
                    </span>
                    <span>Ana Gómez</span>
                </Row>
            );
        case 'relation':
            return (
                <Row>
                    <Chip label={__('Factura #1042')} color="slate" />
                </Row>
            );
        case 'file':
            return (
                <Row>
                    <Paperclip className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                    <span className="imcrm-text-primary">contrato.pdf</span>
                </Row>
            );
        case 'computed':
            return (
                <Row>
                    <span className="imcrm-tabular-nums">{formatNumber(3750)}</span>
                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('(calculado)')}</span>
                </Row>
            );
        // Fórmulas (A1): la fórmula y lo que da.
        case 'formula':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-truncate imcrm-font-mono imcrm-text-[11px]">
                        <span className="imcrm-font-semibold imcrm-text-primary">SI</span>({'{'}
                        <span className="imcrm-text-violet-700 dark:imcrm-text-violet-200">Total</span>
                        {'}'} &gt; 1000000, <span className="imcrm-text-emerald-700 dark:imcrm-text-emerald-300">{'"Grande"'}</span>, …)
                    </span>
                    <Row>
                        <span className="imcrm-font-medium">{__('Grande')}</span>
                        <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('(se calcula sola)')}</span>
                    </Row>
                </div>
            );
        case 'lookup':
            return (
                <Row>
                    <span>+57 300 111 2233</span>
                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('(del cliente)')}</span>
                </Row>
            );
        case 'ai':
            return (
                <Row>
                    <span className="imcrm-text-primary">✦</span>
                    <span className="imcrm-truncate">{__('Cliente molesto por la demora; pide descuento.')}</span>
                </Row>
            );
        case 'rollup':
            return (
                <Row>
                    <span className="imcrm-tabular-nums">$ {formatNumber(1250000)}</span>
                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('(3 facturas)')}</span>
                </Row>
            );
        // Campo «Botón»: dos botones como se ven en la columna.
        case 'button':
            return (
                <Row>
                    <FieldButtonView label={__('WhatsApp')} color="green" icon="message" size="cell" inert />
                    <FieldButtonView label={__('Marcar pagado')} color="blue" icon="check" size="cell" inert />
                </Row>
            );
        // v0.1.300 — ID automático y columnas de sistema.
        case 'autonumber':
            return (
                <Row>
                    <span className="imcrm-font-mono imcrm-tabular-nums">TCK-0042</span>
                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('(se asigna solo)')}</span>
                </Row>
            );
        case 'created_at':
        case 'updated_at':
            return (
                <Row>
                    <span className="imcrm-tabular-nums">{formatDateTime(new Date(Date.UTC(2026, 9, 14, 15, 30)))}</span>
                </Row>
            );
        case 'created_by':
        case 'updated_by':
            return (
                <Row>
                    <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[9px] imcrm-font-medium">
                        AG
                    </span>
                    <span>Ana Gómez</span>
                </Row>
            );
    }
}
