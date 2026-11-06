import { useState } from 'react';
import { Globe, Link2, Plus, Tag, Type, X } from 'lucide-react';

import {
    ATTRIBUTION_FIELD_TYPES,
    ATTRIBUTION_KEYS,
    ATTRIBUTION_LABELS,
    ATTRIBUTION_URL_KEYS,
    attributionFieldFor,
    attributionFieldKey,
    FORM_NAME_FIELD_TYPES,
    isFormFixedValueType,
    type AttributionKey,
    type AttributionSettings,
    type FormConfig,
    type FormRecordValues,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useCreateField } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { Field, Section, Segmented } from '../../automations/email/EmailBlockInspector';
import { CompactFieldRow } from '../../records/crm/CompactFieldRow';
import { updateSettings } from '../formDesignOps';

const selectClass =
    'imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring';

/** Lo que va arriba, solo: de qué página y de qué sitio llegó. */
const PAGE_KEYS: readonly AttributionKey[] = ['page_url', 'referrer'];
/** La campaña y los ids de clic de los anuncios (plegado). */
const CAMPAIGN_KEYS = ATTRIBUTION_KEYS.filter((k) => !PAGE_KEYS.includes(k));
const CAMPAIGN_DEFAULT: readonly AttributionKey[] = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'];

/** El nombre de la columna que se crea para un dato. */
function columnLabel(k: AttributionKey): string {
    if (k === 'page_url') return __('Página de origen');
    if (k === 'referrer') return __('Llegó desde');
    return ATTRIBUTION_LABELS[k].replace(/\s*\([^)]*\)\s*$/, '');
}

/** Las columnas de origen que usa la configuración. */
function chosenIds(a: AttributionSettings): Set<number> {
    const out = new Set<number>();
    for (const k of ATTRIBUTION_KEYS) {
        const id = attributionFieldFor(a, k);
        if (id !== null) out.add(id);
    }
    return out;
}

/** Cambia una columna de origen; «encendido» = hay al menos una columna. */
export function setAttributionColumn(a: AttributionSettings, k: AttributionKey, id: number | null): AttributionSettings {
    const next = { ...a, enabled: a.enabled, [attributionFieldKey(k)]: id } as AttributionSettings;
    next.enabled = ATTRIBUTION_KEYS.some((key) => attributionFieldFor(next, key) !== null);
    return next;
}

/** Las columnas como se muestran (apagado = ninguna, aunque hubiera ids guardados). */
function visibleAttribution(a: AttributionSettings): AttributionSettings {
    if (a.enabled) return a;
    const out = { ...a } as Record<string, unknown>;
    for (const k of ATTRIBUTION_KEYS) out[attributionFieldKey(k)] = null;
    return out as AttributionSettings;
}

/**
 * v0.1.386 — Las columnas donde se guarda de dónde llegó cada registro: la
 * página desde donde se envió, el sitio anterior y (plegado) la campaña y los
 * ids de clic de los anuncios. Lo usan el formulario («Origen y etiquetas») y
 * la agenda («Medir conversiones»).
 */
export function OriginColumns({
    kind,
    attribution,
    onChange,
    fields,
    takenFieldIds,
    listId,
}: {
    kind: 'form' | 'booking';
    attribution: AttributionSettings;
    onChange: (next: AttributionSettings) => void;
    fields: FieldEntity[];
    takenFieldIds: ReadonlySet<number>;
    listId: number | string;
}): JSX.Element {
    const a = visibleAttribution(attribution);
    const [showCampaign, setShowCampaign] = useState(() => CAMPAIGN_KEYS.some((k) => attributionFieldFor(a, k) !== null));
    const [creating, setCreating] = useState<string | null>(null);
    const create = useCreateField(listId);
    const toast = useToast();
    const usable = fields.filter((f) => ATTRIBUTION_FIELD_TYPES.has(f.type) && !takenFieldIds.has(f.id));
    const used = chosenIds(a);

    /** Crea las columnas que faltan de estos datos (enlace para las direcciones, texto el resto) y las elige. */
    const createColumns = async (keys: readonly AttributionKey[], tag: string): Promise<void> => {
        const missing = keys.filter((k) => attributionFieldFor(a, k) === null);
        if (missing.length === 0) return;
        setCreating(tag);
        let next = a;
        try {
            for (const k of missing) {
                const f = await create.mutateAsync({ label: columnLabel(k), type: ATTRIBUTION_URL_KEYS.has(k) ? 'url' : 'text', is_required: false, config: {} } as never);
                next = setAttributionColumn(next, k, f.id);
            }
            onChange(next);
            toast.success(__('Columnas listas'), __('Guarda para que empiecen a llenarse con cada registro nuevo.'));
        } catch (err) {
            onChange(next);
            toast.error(__('No se pudieron crear todas las columnas'), err instanceof Error ? err.message : undefined);
        } finally {
            setCreating(null);
        }
    };

    const row = (k: AttributionKey): JSX.Element => {
        const current = attributionFieldFor(a, k);
        return (
            <div key={k} className="imcrm-grid imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1fr)] imcrm-items-center imcrm-gap-2">
                <span className="imcrm-text-xs imcrm-leading-snug" title={ATTRIBUTION_LABELS[k]}>
                    {__(ATTRIBUTION_LABELS[k])}
                </span>
                <select
                    className={selectClass}
                    value={current === null ? '' : String(current)}
                    onChange={(e) => onChange(setAttributionColumn(a, k, e.target.value === '' ? null : Number(e.target.value)))}
                    data-testid={`attribution-field-${k}`}
                >
                    <option value="">{__('No guardar')}</option>
                    {usable
                        .filter((f) => f.id === current || !used.has(f.id))
                        .map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                </select>
            </div>
        );
    };

    const pageTour = kind === 'booking' ? undefined : 'form-origin-page';
    const pageMissing = PAGE_KEYS.some((k) => attributionFieldFor(a, k) === null);
    const campaignVisible = showCampaign ? CAMPAIGN_KEYS : [];
    const campaignMissing = CAMPAIGN_DEFAULT.some((k) => attributionFieldFor(a, k) === null);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="attribution-settings">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour={pageTour}>
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    <Globe className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                    <span>
                        {kind === 'booking'
                            ? __('La dirección exacta de la página de tu sitio donde estaba la agenda, y el sitio desde donde llegó la persona.')
                            : __('La dirección exacta de la página de tu sitio donde estaba el formulario (o el enlace directo, si lo abrieron así) y el sitio desde donde llegó la persona. Sirve para saber de qué landing llegó cada registro y para filtrar automatizaciones («sólo si la página contiene /navidad»).')}
                    </span>
                </p>
                {PAGE_KEYS.map(row)}
                {pageMissing && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="imcrm-self-start"
                        onClick={() => void createColumns(PAGE_KEYS, 'page')}
                        disabled={creating !== null}
                        data-testid="attribution-create-page"
                    >
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {creating === 'page' ? __('Creando…') : __('Crear las columnas')}
                    </Button>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                <button
                    type="button"
                    className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-left imcrm-text-xs imcrm-font-medium"
                    onClick={() => setShowCampaign((v) => !v)}
                    aria-expanded={showCampaign}
                    data-testid="attribution-campaign-toggle"
                >
                    <span>{__('Campaña y anuncio (utm, id del clic)')}</span>
                    <span className="imcrm-text-[11px] imcrm-font-normal imcrm-text-primary">{showCampaign ? __('Ocultar') : __('Ver')}</span>
                </button>
                {showCampaign && (
                    <>
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Lo que trae la dirección cuando llegan por un anuncio o un enlace con campaña (utm_source, utm_campaign, gclid…). Así ves en un tablero qué campaña trae clientes.')}
                        </p>
                        {campaignVisible.map(row)}
                        {campaignMissing && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="imcrm-self-start"
                                onClick={() => void createColumns(CAMPAIGN_DEFAULT, 'campaign')}
                                disabled={creating !== null}
                                data-testid="attribution-create-columns"
                            >
                                <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                {creating === 'campaign' ? __('Creando…') : __('Crear las columnas de campaña')}
                            </Button>
                        )}
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Para no perder la campaña cuando la persona navega por tu sitio antes de llegar, pega el script de inserción en todas las páginas (pesa poco y queda guardado en el navegador).')}
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * v0.1.386 — «Origen y etiquetas» del formulario: la página desde donde se
 * envió, el nombre del formulario en una columna y valores fijos (una
 * etiqueta, un estado, el responsable…) en cada registro que llega por aquí.
 */
export function FormOriginSettings({
    config,
    onChange,
    fields,
    listId,
    formName,
    takenFieldIds,
}: {
    config: FormConfig;
    onChange: (next: FormConfig) => void;
    fields: FieldEntity[];
    listId: number;
    formName: string;
    /** Lo que el formulario escribe por otro lado (preguntas, cálculos). */
    takenFieldIds: ReadonlySet<number>;
}): JSX.Element {
    const s = config.settings;
    const rv = s.record_values;
    const setRv = (patch: Partial<FormRecordValues>): void => onChange(updateSettings(config, { record_values: { ...rv, ...patch } }));
    const create = useCreateField(listId);
    const toast = useToast();
    const [creatingName, setCreatingName] = useState(false);
    const [adding, setAdding] = useState('');
    const byId = new Map(fields.map((f) => [f.id, f]));

    const originIds = chosenIds(visibleAttribution(s.attribution));
    const fixedIds = new Set(rv.fixed.map((x) => x.field_id));
    // Las columnas de origen no pueden ser ni las preguntas ni lo de «Origen y etiquetas».
    const takenForOrigin = new Set<number>([...takenFieldIds, ...fixedIds, ...(rv.form_name_field_id ? [rv.form_name_field_id] : [])]);
    const nameOptions = fields.filter(
        (f) => FORM_NAME_FIELD_TYPES.has(f.type) && (f.id === rv.form_name_field_id || (!takenFieldIds.has(f.id) && !originIds.has(f.id) && !fixedIds.has(f.id))),
    );
    const fixedOptions = fields.filter(
        (f) =>
            isFormFixedValueType(f.type) &&
            !fixedIds.has(f.id) &&
            f.id !== rv.form_name_field_id &&
            !originIds.has(f.id) &&
            (!takenFieldIds.has(f.id) || f.type === 'multi_select'),
    );
    const publicTitle = s.title.trim();

    const createNameColumn = async (): Promise<void> => {
        setCreatingName(true);
        try {
            const f = await create.mutateAsync({ label: __('Formulario'), type: 'text', is_required: false, config: {} } as never);
            setRv({ form_name_field_id: f.id });
            toast.success(__('Columna lista'), __('Guarda para que empiece a llenarse con cada registro nuevo.'));
        } catch (err) {
            toast.error(__('No se pudo crear la columna'), err instanceof Error ? err.message : undefined);
        } finally {
            setCreatingName(false);
        }
    };

    const addFixed = (id: number): void => {
        const f = byId.get(id);
        if (!f) return;
        const initial: unknown = f.type === 'checkbox' ? true : f.type === 'multi_select' ? [] : null;
        setRv({ fixed: [...rv.fixed, { field_id: id, value: initial }] });
        setAdding('');
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="form-origin">
            <Section title={__('Página desde donde se envió')}>
                <OriginColumns
                    kind="form"
                    attribution={s.attribution}
                    onChange={(attribution) => onChange(updateSettings(config, { attribution }))}
                    fields={fields}
                    takenFieldIds={takenForOrigin}
                    listId={listId}
                />
            </Section>

            <Section title={__('Nombre del formulario')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="form-origin-name">
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        <Type className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                        {__('Si la lista tiene varios formularios, así sabes de cuál llegó cada registro: para filtrar, agrupar o armar una automatización distinta para cada uno.')}
                    </p>
                    <Field label={__('Guardarlo en la columna')}>
                        <select
                            className={selectClass}
                            value={rv.form_name_field_id === null ? '' : String(rv.form_name_field_id)}
                            onChange={(e) => setRv({ form_name_field_id: e.target.value === '' ? null : Number(e.target.value) })}
                            data-testid="form-name-field"
                        >
                            <option value="">{__('No guardar')}</option>
                            {nameOptions.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    {rv.form_name_field_id === null ? (
                        <Button size="sm" variant="outline" className="imcrm-self-start" onClick={() => void createNameColumn()} disabled={creatingName} data-testid="form-name-create">
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {creatingName ? __('Creando…') : __('Crear la columna «Formulario»')}
                        </Button>
                    ) : (
                        <Segmented<'name' | 'title'>
                            label={__('Qué nombre')}
                            value={rv.form_name_source}
                            options={[
                                { value: 'name', label: sprintf(__('El interno: «%s»'), formName || __('sin nombre')) },
                                { value: 'title', label: sprintf(__('El título: «%s»'), publicTitle || formName || __('sin título')) },
                            ]}
                            onChange={(v) => setRv({ form_name_source: v })}
                        />
                    )}
                </div>
            </Section>

            <Section title={__('Valores fijos en cada registro')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="form-origin-fixed" data-testid="form-fixed-values">
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        <Tag className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                        {__('Se ponen solos en cada registro que llega por este formulario: una etiqueta («Landing Navidad»), un estado, el responsable o el equipo que le toca. Si el formulario también pregunta ese campo, gana lo que respondió la persona (en «varias opciones» se suman).')}
                    </p>
                    {rv.fixed.length > 0 && (
                        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                            {rv.fixed.map((fv, i) => {
                                const f = byId.get(fv.field_id);
                                if (!f) return null;
                                return (
                                    <li key={fv.field_id} className="imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-pr-2" data-fixed-field={f.slug}>
                                        <div className="imcrm-min-w-0 imcrm-flex-1">
                                            <CompactFieldRow
                                                field={f}
                                                listId={listId}
                                                variant="property"
                                                scan={false}
                                                value={fv.value ?? null}
                                                onChange={(v) => setRv({ fixed: rv.fixed.map((x, j) => (j === i ? { ...x, value: v } : x)) })}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setRv({ fixed: rv.fixed.filter((_, j) => j !== i) })}
                                            className="imcrm-mt-1.5 imcrm-shrink-0 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                            aria-label={sprintf(__('Quitar «%s»'), f.label)}
                                        >
                                            <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {fixedOptions.length > 0 ? (
                        <select
                            className={selectClass}
                            value={adding}
                            onChange={(e) => {
                                if (e.target.value !== '') addFixed(Number(e.target.value));
                            }}
                            aria-label={__('Agregar un valor fijo')}
                            data-testid="form-fixed-add"
                        >
                            <option value="">{rv.fixed.length ? __('+ Agregar otro valor…') : __('+ Agregar un valor…')}</option>
                            {fixedOptions.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </select>
                    ) : (
                        rv.fixed.length === 0 && (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('La lista no tiene columnas libres para un valor fijo. Agrega una columna de «Selección» o «Varias opciones» (por ejemplo «Etiquetas») en la tabla.')}
                            </p>
                        )
                    )}
                    {rv.fixed.some((fv) => {
                        const f = byId.get(fv.field_id);
                        return f !== undefined && f.type !== 'checkbox' && (fv.value === null || fv.value === '' || (Array.isArray(fv.value) && fv.value.length === 0));
                    }) && (
                        <p className="imcrm-text-[11px] imcrm-text-warning-foreground" data-testid="form-fixed-empty">
                            {__('Un valor vacío no se guarda: elige qué poner o quítalo.')}
                        </p>
                    )}
                </div>
            </Section>
        </div>
    );
}
