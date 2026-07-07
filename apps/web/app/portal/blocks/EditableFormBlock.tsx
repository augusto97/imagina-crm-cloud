import { useState } from 'react';

import type { PortalBootData, PortalRecord } from '../types';

interface EditableFieldMeta {
    slug: string;
    label: string;
    type: string;
    config?: Record<string, unknown>;
}

interface Props {
    config: {
        editable_field_slugs?: string[];
        /**
         * Enriquecido server-side por `PortalController::enrichTemplateBlocks`.
         * Contiene los FieldEntity de cada slug en `editable_field_slugs`.
         * Si está disponible, se usan para renderizar inputs específicos
         * por tipo. Sino fallback a inputs text genéricos.
         */
        editable_fields?: EditableFieldMeta[];
        title?: string;
        submit_label?: string;
    };
    record: PortalRecord;
    boot: PortalBootData;
}

/**
 * Bloque `editable_form` (Fase 9 — 3.E). Form para que el cliente
 * actualice un subset whitelisteado de sus propios campos.
 *
 * La whitelist se respeta TAMBIÉN server-side via
 * `PortalController::updateMe` — el backend rechaza con 403 cualquier
 * slug fuera de la lista declarada en el template. Acá la usamos solo
 * para renderizar los inputs correctos.
 *
 * Limitaciones de 3.E:
 *  - Tipos de input son todos `text` por ahora (no tenemos el `type`
 *    de cada field en el shape del template). Mejora: incluir
 *    `editable_field_types` en la config del bloque.
 *  - Sin validación client-side por tipo. El backend hace la
 *    validación real vía `RecordValidator`.
 */
export function EditableFormBlock({ config, record, boot }: Props): JSX.Element {
    // Preferimos `editable_fields` (con types) sobre `editable_field_slugs`
    // (solo slugs). El primero llega del PortalController enriquecido.
    const fields: EditableFieldMeta[] =
        config.editable_fields !== undefined && config.editable_fields.length > 0
            ? config.editable_fields
            : (config.editable_field_slugs ?? []).map((slug) => ({
                  slug,
                  label: slug,
                  type: 'text',
              }));

    const [values, setValues] = useState<Record<string, unknown>>(() => {
        const out: Record<string, unknown> = {};
        for (const f of fields) {
            out[f.slug] = record.fields[f.slug] ?? '';
        }
        return out;
    });
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setSubmitting(true);
        setFeedback(null);

        // Solo enviamos los slugs declarados — defensa adicional
        // contra inputs que se hayan colado en `values`.
        const payload: Record<string, unknown> = {};
        for (const f of fields) {
            const v = values[f.slug];
            if (v !== undefined) {
                payload[f.slug] = v;
            }
        }

        try {
            const url = `${boot.rest_root.replace(/\/$/, '')}/portal/me`;
            const res = await fetch(url, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WP-Nonce': boot.rest_nonce,
                    Accept: 'application/json',
                },
                body: JSON.stringify({ fields: payload }),
            });
            if (!res.ok) {
                if (res.status === 403) {
                    setFeedback({ kind: 'error', msg: 'No tienes permiso para editar uno o más campos.' });
                } else if (res.status === 422) {
                    const body = await res.json().catch(() => null);
                    const firstErr = (body as { message?: string } | null)?.message;
                    setFeedback({
                        kind: 'error',
                        msg: firstErr ?? 'Algunos valores no son válidos.',
                    });
                } else {
                    setFeedback({ kind: 'error', msg: 'No se pudo guardar. Reintenta en unos segundos.' });
                }
                setSubmitting(false);
                return;
            }
            setFeedback({ kind: 'success', msg: 'Cambios guardados.' });
        } catch (err) {
            setFeedback({ kind: 'error', msg: 'Error de conexión. Reintenta.' });
            // eslint-disable-next-line no-console
            console.warn('[imagina-crm portal] update failed', err);
        } finally {
            setSubmitting(false);
        }
    };

    if (fields.length === 0) {
        return (
            <section className="imcrm-portal-block imcrm-portal-block--editable-form">
                <h2 className="imcrm-portal-block__title">{config.title ?? 'Editar mis datos'}</h2>
                <p className="imcrm-portal-block__empty">
                    Este bloque no tiene campos editables configurados.
                </p>
            </section>
        );
    }

    return (
        <section className="imcrm-portal-block imcrm-portal-block--editable-form">
            <h2 className="imcrm-portal-block__title">{config.title ?? 'Editar mis datos'}</h2>
            <form className="imcrm-portal-form" onSubmit={handleSubmit}>
                {fields.map((field) => (
                    <div key={field.slug} className="imcrm-portal-form__field">
                        <label
                            htmlFor={`imcrm-portal-${field.slug}`}
                            className="imcrm-portal-form__label"
                        >
                            {field.label}
                        </label>
                        <FieldInput
                            field={field}
                            value={values[field.slug]}
                            onChange={(v) => setValues((cur) => ({ ...cur, [field.slug]: v }))}
                            disabled={submitting}
                        />
                    </div>
                ))}
                {feedback !== null ? (
                    <p
                        className={`imcrm-portal-form__feedback imcrm-portal-form__feedback--${feedback.kind}`}
                        role={feedback.kind === 'error' ? 'alert' : 'status'}
                    >
                        {feedback.msg}
                    </p>
                ) : null}
                <button
                    type="submit"
                    disabled={submitting}
                    className="imcrm-portal-card__btn imcrm-portal-form__submit"
                >
                    {submitting ? 'Guardando…' : config.submit_label ?? 'Guardar'}
                </button>
            </form>
        </section>
    );
}

/**
 * Input específico por tipo de field. Cubre los tipos editables más
 * comunes en el portal. Tipos no editables inline (relation, file,
 * user, computed) caen a un text input read-only — el admin no
 * debería poner esos slugs en `editable_field_slugs`.
 */
function FieldInput({
    field,
    value,
    onChange,
    disabled,
}: {
    field: EditableFieldMeta;
    value: unknown;
    onChange: (v: unknown) => void;
    disabled: boolean;
}): JSX.Element {
    const id = `imcrm-portal-${field.slug}`;
    const baseClass = 'imcrm-portal-form__input';

    switch (field.type) {
        case 'long_text':
            return (
                <textarea
                    id={id}
                    className={`${baseClass} imcrm-portal-form__textarea`}
                    rows={4}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            );
        case 'number':
        case 'currency':
            return (
                <input
                    id={id}
                    type="number"
                    step="any"
                    className={baseClass}
                    value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                    disabled={disabled}
                />
            );
        case 'email':
            return (
                <input
                    id={id}
                    type="email"
                    className={baseClass}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            );
        case 'url':
            return (
                <input
                    id={id}
                    type="url"
                    className={baseClass}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            );
        case 'date':
            return (
                <input
                    id={id}
                    type="date"
                    className={baseClass}
                    value={typeof value === 'string' ? value.slice(0, 10) : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            );
        case 'datetime':
            return (
                <input
                    id={id}
                    type="datetime-local"
                    className={baseClass}
                    value={typeof value === 'string' ? value.slice(0, 16) : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            );
        case 'checkbox':
            return (
                <input
                    id={id}
                    type="checkbox"
                    className="imcrm-portal-form__checkbox"
                    checked={value === true || value === 1 || value === '1'}
                    onChange={(e) => onChange(e.target.checked)}
                    disabled={disabled}
                />
            );
        case 'select': {
            const options = extractOptions(field.config);
            return (
                <select
                    id={id}
                    className={baseClass}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                >
                    <option value="">—</option>
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label ?? opt.value}
                        </option>
                    ))}
                </select>
            );
        }
        case 'multi_select': {
            const options = extractOptions(field.config);
            const selected = new Set(Array.isArray(value) ? value.map(String) : []);
            return (
                <div className="imcrm-portal-form__checkbox-group">
                    {options.map((opt) => (
                        <label key={opt.value} className="imcrm-portal-form__checkbox-label">
                            <input
                                type="checkbox"
                                checked={selected.has(opt.value)}
                                onChange={(e) => {
                                    const next = new Set(selected);
                                    if (e.target.checked) next.add(opt.value);
                                    else next.delete(opt.value);
                                    onChange(Array.from(next));
                                }}
                                disabled={disabled}
                            />
                            {opt.label ?? opt.value}
                        </label>
                    ))}
                </div>
            );
        }
        default:
            return (
                <input
                    id={id}
                    type="text"
                    className={baseClass}
                    value={typeof value === 'string' ? value : value !== null && value !== undefined ? String(value) : ''}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            );
    }
}

/**
 * Extrae las opciones de un field tipo `select`/`multi_select` de su
 * `config`. Tolera dos shapes legacy:
 *  - `config.options: [{value, label}]` (formato actual).
 *  - `config.options: ['value1', 'value2']` (legacy — labels = value).
 */
function extractOptions(
    cfg: Record<string, unknown> | undefined,
): Array<{ value: string; label?: string }> {
    if (cfg === undefined) return [];
    const raw = cfg.options;
    if (!Array.isArray(raw)) return [];
    const out: Array<{ value: string; label?: string }> = [];
    for (const opt of raw) {
        if (typeof opt === 'string') {
            out.push({ value: opt });
        } else if (opt !== null && typeof opt === 'object') {
            const o = opt as { value?: unknown; label?: unknown };
            if (typeof o.value === 'string') {
                out.push({
                    value: o.value,
                    label: typeof o.label === 'string' ? o.label : undefined,
                });
            }
        }
    }
    return out;
}
