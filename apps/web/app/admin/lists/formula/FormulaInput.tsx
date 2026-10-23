import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    FORMULA_FUNCTIONS,
    formulaRefNotAllowed,
    formulaSignature,
    refDisplayName,
    escapeRefName,
    type FormulaFunctionDef,
} from '@imagina-base/shared';

import { FIELD_TYPE_ICONS } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import {
    applyCompletion,
    completionContext,
    fold,
    functionInsertText,
    highlightSegments,
    signatureContext,
    type CompletionContext,
    type Segment,
    type SegmentKind,
} from './formulaEditing';

/**
 * Fórmulas (A1) — la caja donde se escribe la fórmula.
 *
 * Un `<textarea>` transparente encima de un `<pre>` que pinta el texto (las
 * funciones, los `{campos}`, los textos y los números en colores distintos y
 * el tramo con error subrayado). Al escribir letras sugiere funciones con su
 * firma y su ayuda; después de `{`, los campos de la lista. Las sugerencias
 * van DEBAJO de la caja (no flotando junto al cursor) para que también se
 * usen cómodas en el celular.
 */
export interface FormulaInputHandle {
    /** Inserta en el cursor (o reemplaza la selección). */
    insert: (text: string, caretOffset?: number) => void;
    focus: () => void;
}

interface Props {
    id?: string;
    value: string;
    onChange: (next: string) => void;
    /** Campos de la lista (para sugerir y pintar). */
    fields: FieldEntity[];
    /** El campo que se edita (no se sugiere: una fórmula no se usa a sí misma). */
    excludeId?: number;
    /** Tramo con error (se subraya). */
    errorRange?: { start: number; end: number } | null;
    invalid?: boolean;
    describedBy?: string;
}

const KIND_CLASS: Record<SegmentKind, string> = {
    fn: 'imcrm-font-semibold imcrm-text-primary',
    ref: 'imcrm-rounded-sm imcrm-bg-violet-500/10 imcrm-text-violet-700 dark:imcrm-text-violet-200',
    str: 'imcrm-text-emerald-700 dark:imcrm-text-emerald-300',
    num: 'imcrm-text-amber-700 dark:imcrm-text-amber-300',
    op: 'imcrm-text-sky-700 dark:imcrm-text-sky-200',
    paren: 'imcrm-text-muted-foreground',
    sep: 'imcrm-text-muted-foreground',
    ident: 'imcrm-text-foreground',
    plain: 'imcrm-text-foreground',
};

interface Suggestion {
    key: string;
    label: string;
    detail: string;
    description?: string;
    icon?: React.ComponentType<{ className?: string }>;
    apply: () => void;
}

export const FormulaInput = forwardRef<FormulaInputHandle, Props>(function FormulaInput(
    { id, value, onChange, fields, excludeId, errorRange, invalid, describedBy },
    ref,
) {
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const preRef = useRef<HTMLPreElement>(null);
    const [caret, setCaret] = useState(value.length);
    const [focused, setFocused] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const pendingCaret = useRef<number | null>(null);

    const syncCaret = useCallback((): void => {
        const el = areaRef.current;
        if (el) setCaret(el.selectionStart ?? el.value.length);
    }, []);

    const write = useCallback(
        (next: string, nextCaret: number): void => {
            pendingCaret.current = nextCaret;
            onChange(next);
            setCaret(nextCaret);
            setDismissed(false);
        },
        [onChange],
    );

    // El cursor se ubica DESPUÉS de que React pinta el valor nuevo.
    useLayoutEffect(() => {
        const el = areaRef.current;
        if (!el || pendingCaret.current === null) return;
        el.focus();
        el.setSelectionRange(pendingCaret.current, pendingCaret.current);
        pendingCaret.current = null;
    }, [value]);

    useImperativeHandle(
        ref,
        () => ({
            insert: (text: string, caretOffset?: number) => {
                const el = areaRef.current;
                const start = el ? el.selectionStart ?? value.length : value.length;
                const end = el ? el.selectionEnd ?? start : start;
                const next = applyCompletion(value, { start, end }, text, caretOffset);
                write(next.text, next.caret);
            },
            focus: () => areaRef.current?.focus(),
        }),
        [value, write],
    );

    // Alto que sigue al contenido (de 3 a 12 renglones).
    useLayoutEffect(() => {
        const el = areaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(Math.max(el.scrollHeight, 76), 260)}px`;
    }, [value]);

    const ctx: CompletionContext = focused && !dismissed ? completionContext(value, caret) : null;

    const suggestions = useMemo<Suggestion[]>(() => {
        if (!ctx) return [];
        if (ctx.kind === 'field') {
            const q = fold(ctx.query.trim());
            const usable = fields.filter((f) => f.id !== excludeId && formulaRefNotAllowed(f.type) === null);
            const scored = usable
                .map((f) => {
                    const label = fold(f.label);
                    const slug = f.slug.toLowerCase();
                    const rank = q === '' ? 1 : label.startsWith(q) || slug.startsWith(q) ? 0 : label.includes(q) || slug.includes(q) ? 1 : -1;
                    return { f, rank };
                })
                .filter((x) => x.rank >= 0)
                .sort((a, b) => a.rank - b.rank || a.f.position - b.f.position)
                .slice(0, 30);
            return scored.map(({ f }) => ({
                key: `f${f.id}`,
                label: f.label,
                detail: f.slug,
                icon: FIELD_TYPE_ICONS[f.type],
                apply: () => {
                    const name = escapeRefName(refDisplayName(f, fields));
                    const next = applyCompletion(value, ctx, `{${name}}`);
                    write(next.text, next.caret);
                },
            }));
        }
        const q = fold(ctx.query);
        const matches = (fn: FormulaFunctionDef): number => {
            const names = [fn.name, ...(fn.aliases ?? [])].map(fold);
            if (names.some((n) => n.startsWith(q))) return 0;
            if (names.some((n) => n.includes(q))) return 1;
            return -1;
        };
        return FORMULA_FUNCTIONS.map((fn) => ({ fn, rank: matches(fn) }))
            .filter((x) => x.rank >= 0)
            .sort((a, b) => a.rank - b.rank || a.fn.name.localeCompare(b.fn.name))
            .slice(0, 12)
            .map(({ fn }) => ({
                key: fn.name,
                label: fn.name,
                detail: formulaSignature(fn),
                description: fn.description,
                apply: () => {
                    const { insert, caretOffset } = functionInsertText(fn, value[ctx.end]);
                    const next = applyCompletion(value, ctx, insert, caretOffset);
                    write(next.text, next.caret);
                },
            }));
        // `ctx` cambia con value/caret; se recalcula con ellos.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctx?.kind, ctx?.query, ctx?.start, ctx?.end, fields, excludeId, value, write]);

    // Sólo una función que ya está escrita entera no necesita la lista.
    const exact = ctx?.kind === 'function' && suggestions.length === 1 && suggestions[0]!.label === ctx.query.toUpperCase();
    const open = suggestions.length > 0 && !exact;

    useEffect(() => {
        setActive(0);
    }, [ctx?.kind, ctx?.query]);

    // Escape cierra las sugerencias y NO el diálogo que contiene la caja (el
    // diálogo escucha Escape en el documento; esto llega antes).
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape' && document.activeElement === areaRef.current) {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(true);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (!open) {
            if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setDismissed(false);
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            suggestions[Math.min(active, suggestions.length - 1)]?.apply();
        }
    };

    const signature = focused && !open ? signatureContext(value, caret) : null;
    const segments = useMemo(() => highlightSegments(value), [value]);
    const listId = id ? `${id}-sugerencias` : undefined;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div
                className={cn(
                    'imcrm-relative imcrm-rounded-md imcrm-border imcrm-bg-background imcrm-transition-colors',
                    invalid ? 'imcrm-border-destructive/70' : 'imcrm-border-input',
                    focused && (invalid ? 'imcrm-ring-2 imcrm-ring-destructive/30' : 'imcrm-ring-2 imcrm-ring-primary/30'),
                )}
            >
                <pre
                    ref={preRef}
                    aria-hidden
                    className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-m-0 imcrm-overflow-hidden imcrm-whitespace-pre-wrap imcrm-break-words imcrm-px-3 imcrm-py-2 imcrm-font-mono imcrm-text-[13px] imcrm-leading-[1.6]"
                >
                    {renderHighlighted(value, segments, errorRange ?? null)}
                    {/* Un renglón vacío al final no colapsa (el textarea sí lo tiene). */}
                    {'\n'}
                </pre>
                <textarea
                    ref={areaRef}
                    id={id}
                    value={value}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    aria-autocomplete="list"
                    aria-controls={open ? listId : undefined}
                    aria-expanded={open}
                    role="combobox"
                    placeholder={__('Ej.: {Precio} * {Cantidad}')}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setCaret(e.target.selectionStart ?? e.target.value.length);
                        setDismissed(false);
                    }}
                    onKeyDown={onKeyDown}
                    onKeyUp={syncCaret}
                    onClick={syncCaret}
                    onSelect={syncCaret}
                    onFocus={() => {
                        setFocused(true);
                        syncCaret();
                    }}
                    onBlur={() => {
                        // Un toque en una sugerencia llega después del blur.
                        window.setTimeout(() => setFocused(false), 150);
                    }}
                    onScroll={(e) => {
                        if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop;
                    }}
                    className="imcrm-relative imcrm-block imcrm-w-full imcrm-resize-none imcrm-bg-transparent imcrm-px-3 imcrm-py-2 imcrm-font-mono imcrm-text-[13px] imcrm-leading-[1.6] imcrm-text-transparent imcrm-caret-foreground placeholder:imcrm-text-muted-foreground focus:imcrm-outline-none"
                    style={{ WebkitTextFillColor: 'transparent' }}
                />
            </div>

            {open && (
                <ul
                    id={listId}
                    role="listbox"
                    aria-label={ctx?.kind === 'field' ? __('Campos') : __('Funciones')}
                    className="imcrm-max-h-56 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-md"
                    data-formula-suggestions=""
                >
                    {suggestions.map((s, i) => {
                        const Icon = s.icon;
                        return (
                            <li key={s.key} role="option" aria-selected={i === active}>
                                <button
                                    type="button"
                                    // Antes del blur del textarea (si no, la lista se cierra primero).
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => s.apply()}
                                    onMouseEnter={() => setActive(i)}
                                    className={cn(
                                        'imcrm-flex imcrm-w-full imcrm-min-w-0 imcrm-flex-col imcrm-items-start imcrm-gap-0.5 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left',
                                        i === active ? 'imcrm-bg-accent imcrm-text-accent-foreground' : 'hover:imcrm-bg-accent/60',
                                    )}
                                >
                                    <span className="imcrm-flex imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                                        {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />}
                                        <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-medium">{s.label}</span>
                                        <span className="imcrm-ml-auto imcrm-truncate imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{s.detail}</span>
                                    </span>
                                    {s.description && (
                                        <span className="imcrm-line-clamp-2 imcrm-text-[11.5px] imcrm-text-muted-foreground">{s.description}</span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {signature && (
                <div
                    className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs"
                    data-formula-signature=""
                >
                    <p className="imcrm-font-mono imcrm-text-[12px]">
                        <span className="imcrm-font-semibold imcrm-text-primary">{signature.fn.name}</span>(
                        {signature.fn.params.map((p, i) => {
                            const current = i === Math.min(signature.argIndex, signature.fn.params.length - 1)
                                || (p.repeat === true && signature.argIndex >= i);
                            const name = p.optional ? `[${p.name}]` : p.name;
                            return (
                                <span key={i}>
                                    {i > 0 && ', '}
                                    <span className={cn(current && 'imcrm-rounded-sm imcrm-bg-primary/15 imcrm-font-semibold imcrm-text-foreground')}>
                                        {p.repeat ? `${name}, …` : name}
                                    </span>
                                </span>
                            );
                        })}
                        )
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-text-muted-foreground">{signature.fn.description}</p>
                </div>
            )}
        </div>
    );
});

/** El texto pintado por tramos; el error (si hay) se subraya encima. */
function renderHighlighted(text: string, segments: Segment[], error: { start: number; end: number } | null): React.ReactNode {
    const out: React.ReactNode[] = [];
    let key = 0;
    const errStart = error ? Math.max(0, Math.min(error.start, text.length)) : -1;
    // Un error al final del texto (falta cerrar algo) se marca en el último carácter.
    const errEnd = error ? Math.max(errStart + 1, Math.min(error.end, text.length)) : -1;
    for (const seg of segments) {
        const cuts = [seg.start, seg.end];
        if (error) {
            if (errStart > seg.start && errStart < seg.end) cuts.push(errStart);
            if (errEnd > seg.start && errEnd < seg.end) cuts.push(errEnd);
        }
        cuts.sort((a, b) => a - b);
        for (let i = 0; i < cuts.length - 1; i++) {
            const a = cuts[i]!;
            const b = cuts[i + 1]!;
            if (b <= a) continue;
            const inErr = error !== null && a >= errStart && b <= errEnd;
            out.push(
                <span
                    key={key++}
                    className={cn(
                        KIND_CLASS[seg.kind],
                        inErr && 'imcrm-underline imcrm-decoration-destructive imcrm-decoration-wavy imcrm-decoration-2 imcrm-underline-offset-4',
                    )}
                >
                    {text.slice(a, b)}
                </span>,
            );
        }
    }
    return out;
}
