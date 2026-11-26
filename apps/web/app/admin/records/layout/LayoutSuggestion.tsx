import { useMemo } from 'react';
import { Eye, LayoutTemplate, Loader2, X } from 'lucide-react';
import { suggestRecordLayoutTemplate, type AutoLayoutFlavor } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';

/** Las plantillas integradas de la ficha, con el nombre que se ve en Apariencia. */
const TEMPLATES: ReadonlyArray<{ id: AutoLayoutFlavor; label: string }> = [
    { id: 'auto', label: __('Automática') },
    { id: 'contact', label: __('Contacto') },
    { id: 'deal', label: __('Venta / Oportunidad') },
    { id: 'task', label: __('Tarea') },
    { id: 'support', label: __('Soporte') },
];

/**
 * La plantilla integrada que mejor le queda a la lista: la MISMA regla que al
 * crearla (`suggestRecordLayoutTemplate`). Vive aquí, en el chunk de la
 * invitación, para que la tabla no cargue sus reglas en el arranque.
 */
export function suggestedTemplateFor(
    list: { name: string },
    fields: ReadonlyArray<{ slug: string; label: string; type: string; config?: unknown }>,
): AutoLayoutFlavor {
    return suggestRecordLayoutTemplate({
        name: list.name,
        fields: fields.map((f) => ({ slug: f.slug, label: f.label, type: f.type, config: (f.config ?? null) as Record<string, unknown> | null })),
    });
}

function templateLabel(id: AutoLayoutFlavor): string {
    return TEMPLATES.find((t) => t.id === id)?.label ?? id;
}

export interface LayoutSuggestionProps {
    /** `card`: la invitación en la ficha simple. `banner`: arriba de la vista previa. */
    mode: 'card' | 'banner';
    /** La lista y sus campos: de ahí sale la plantilla que mejor le queda. */
    list: { name: string };
    fields: ReadonlyArray<{ slug: string; label: string; type: string; config?: unknown }>;
    /** La que se está mirando en la vista previa. */
    preview: AutoLayoutFlavor | null;
    busy: boolean;
    /** «Probar» con la plantilla sugerida. */
    onTry: (template: AutoLayoutFlavor) => void;
    onUse: (template: AutoLayoutFlavor) => void;
    onChangeTemplate: (template: AutoLayoutFlavor) => void;
    onDismiss: () => void;
}

/**
 * v0.1.470 — «Esta lista se puede ver como ficha»: a quien administra una
 * lista que todavía usa la ficha simple se le ofrece UNA vez probar la ficha
 * diseñada con la plantilla que le corresponde. «Probar» la muestra sin
 * guardar nada; «Usar este diseño» la deja para todos; «Ahora no» y la X la
 * esconden para esa persona y esa lista.
 */
export default function LayoutSuggestion(props: LayoutSuggestionProps): JSX.Element {
    if (props.mode === 'card') return <SuggestionCard {...props} />;
    return <PreviewBanner {...props} />;
}

function SuggestionCard({ list, fields, onTry, onDismiss }: LayoutSuggestionProps): JSX.Element {
    const suggested = useMemo(() => suggestedTemplateFor(list, fields), [list, fields]);
    return (
        <div
            className="imcrm-relative imcrm-mb-4 imcrm-flex imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-pr-9"
            data-tour="record-layout-suggestion"
            data-testid="imcrm-layout-suggestion"
        >
            <span className="imcrm-mt-0.5 imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                <LayoutTemplate className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Esta lista se puede ver como ficha')}</p>
                <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(
                        /* translators: %s: nombre de la plantilla de la ficha */
                        __('Cada registro con lo más importante arriba, sus campos agrupados y lo vinculado en pestañas. Te sugerimos la plantilla «%s». Pruébala: no se guarda nada hasta que lo decidas.'),
                        templateLabel(suggested),
                    )}
                </p>
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button size="sm" className="imcrm-gap-1.5" onClick={() => onTry(suggested)} data-testid="imcrm-layout-suggestion-try">
                        <Eye className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Probar')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onDismiss} data-testid="imcrm-layout-suggestion-dismiss">
                        {__('Ahora no')}
                    </Button>
                </div>
            </div>
            <button
                type="button"
                onClick={onDismiss}
                aria-label={__('Cerrar')}
                title={__('Cerrar')}
                className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
            >
                <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </button>
        </div>
    );
}

function PreviewBanner({ preview, busy, onUse, onChangeTemplate, onDismiss }: LayoutSuggestionProps): JSX.Element {
    const current = preview ?? 'auto';
    return (
        <div
            className="imcrm-mb-4 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 sm:imcrm-flex-row sm:imcrm-flex-wrap sm:imcrm-items-center"
            data-tour="record-layout-suggestion"
            data-testid="imcrm-layout-preview-banner"
            role="status"
        >
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold">
                    <Eye className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                    {__('Vista previa: así se vería esta ficha')}
                </p>
                <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('El diseño todavía no se guardó. Lo que cambies en los campos sí se guarda en el registro.')}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <span>{__('Elegir otra plantilla')}</span>
                    <select
                        value={current}
                        disabled={busy}
                        onChange={(e) => onChangeTemplate(e.target.value as AutoLayoutFlavor)}
                        className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm imcrm-text-foreground"
                        data-testid="imcrm-layout-preview-template"
                    >
                        {TEMPLATES.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </label>
                <Button size="sm" className="imcrm-gap-1.5" disabled={busy} onClick={() => onUse(current)} data-testid="imcrm-layout-preview-use">
                    {busy && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />}
                    {__('Usar este diseño')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss} data-testid="imcrm-layout-preview-dismiss">
                    {__('Ahora no')}
                </Button>
            </div>
        </div>
    );
}
