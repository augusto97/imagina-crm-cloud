import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CalendarCheck2, ExternalLink } from 'lucide-react';
import {
    MEETING_SAVE_FIELD_TYPES,
    MEETING_SAVE_KEYS,
    missingActionScopes,
    type MeetingActionKind,
    type MeetingSaveKey,
} from '@imagina-base/shared';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCreateField } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { ActionSpec } from '@/types/automation';

/**
 * v0.1.366 — Lo que una acción de calendario hace con el registro: al crear o
 * reprogramar, guarda el enlace para unirse y el id del evento en dos campos
 * (con el id, otra automatización la reprograma o la cancela); al cancelar,
 * vacía esos mismos campos. Las claves van en la config del paso, al lado de
 * `values` (no son datos que se mandan al calendario).
 */

const CREATE_VALUE = '__create__';

const LABELS: Record<MeetingSaveKey, { title: string; newLabel: string; newType: 'url' | 'text' }> = {
    save_meeting_link: { title: 'Enlace para unirse', newLabel: 'Enlace de la reunión', newType: 'url' },
    save_event_id: { title: 'Id del evento', newLabel: 'Id del evento', newType: 'text' },
};

export function MeetingSaveFields({
    kind,
    spec,
    onChange,
    fields,
    listId,
}: {
    kind: MeetingActionKind;
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
    listId: number | null | undefined;
}): JSX.Element {
    const createField = useCreateField(listId ?? 0);
    const [creating, setCreating] = useState<MeetingSaveKey | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cancel = kind === 'cancel';

    const setKey = (key: MeetingSaveKey, slug: string): void => {
        const config = { ...spec.config };
        if (slug === '') delete config[key];
        else config[key] = slug;
        onChange({ ...spec, config });
    };

    const create = async (key: MeetingSaveKey): Promise<void> => {
        if (!listId) return;
        setCreating(key);
        setError(null);
        try {
            const field = await createField.mutateAsync({ label: __(LABELS[key].newLabel), type: LABELS[key].newType });
            setKey(key, field.slug);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setCreating(null);
        }
    };

    return (
        <div
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3"
            data-testid="imcrm-meeting-save-fields"
        >
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                <CalendarCheck2 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {cancel ? __('Al cancelar, vaciar en el registro') : __('Guardar en el registro')}
            </p>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {cancel
                    ? __('Los campos donde guardaste el enlace y el id de la reunión quedan vacíos, así se ve que ya no hay reunión.')
                    : __('Guarda el id para poder reprogramar o cancelar la reunión después desde otra automatización. En un paso siguiente (un WhatsApp o un correo) el enlace es {{reunion.enlace}} y el id {{reunion.id}}.')}
            </p>
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                {MEETING_SAVE_KEYS.map((key) => {
                    const allowed = MEETING_SAVE_FIELD_TYPES[key];
                    const options = fields.filter((f) => allowed.includes(f.type));
                    const value = typeof spec.config[key] === 'string' ? (spec.config[key] as string) : '';
                    const missing = value !== '' && !options.some((f) => f.slug === value);
                    return (
                        <div key={key} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__(LABELS[key].title)}</Label>
                            <Select
                                value={value}
                                disabled={creating !== null}
                                onChange={(e) => {
                                    const next = e.target.value;
                                    if (next === CREATE_VALUE) void create(key);
                                    else setKey(key, next);
                                }}
                                data-testid={`imcrm-meeting-${key}`}
                            >
                                <option value="">{cancel ? __('(no vaciar nada)') : __('(no guardar)')}</option>
                                {missing && (
                                    <option value={value}>
                                        {sprintf(
                                            /* translators: %s: field slug */
                                            __('«%s» (ya no es un campo de texto)'),
                                            value,
                                        )}
                                    </option>
                                )}
                                {options.map((f) => (
                                    <option key={f.id} value={f.slug}>
                                        {f.label}
                                    </option>
                                ))}
                                {!cancel && listId && (
                                    <option value={CREATE_VALUE}>
                                        {sprintf(
                                            /* translators: %s: new field label */
                                            __('+ Crear el campo «%s»'),
                                            __(LABELS[key].newLabel),
                                        )}
                                    </option>
                                )}
                            </Select>
                            {creating === key && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Creando el campo…')}</p>}
                        </div>
                    );
                })}
            </div>
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </div>
    );
}

/**
 * v0.1.366 — Una conexión de Teams de antes no tiene permiso para el
 * calendario: sigue mandando mensajes, pero para las reuniones hay que volver
 * a conectarla. Se avisa en la acción, no recién cuando falla.
 */
export function MeetingScopeNotice({
    integrationKey,
    actionKey,
    grantedScopes,
}: {
    integrationKey: string | null | undefined;
    actionKey: string;
    grantedScopes: string | null | undefined;
}): JSX.Element | null {
    const lacking = missingActionScopes(integrationKey ?? '', actionKey, grantedScopes ?? '');
    if (lacking.length === 0) return null;
    return (
        <div
            className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-xs"
            data-testid="imcrm-meeting-scope-notice"
        >
            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-font-medium">{__('Esta conexión todavía no puede crear reuniones')}</p>
                <p className="imcrm-text-muted-foreground">
                    {__('Se conectó antes de que existieran las reuniones de Teams. Vuelve a conectarla y acepta el permiso del calendario (los mensajes siguen funcionando mientras tanto). Si tu empresa pide la aprobación del administrador, crea el enlace otra vez.')}
                </p>
                <Link
                    to="/settings?s=conectores"
                    target="_blank"
                    rel="noreferrer"
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                >
                    {__('Ir a Integraciones')}
                    <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                </Link>
            </div>
        </div>
    );
}
