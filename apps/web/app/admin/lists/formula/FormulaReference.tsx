import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Search } from 'lucide-react';
import {
    FORMULA_CATEGORY_LABELS,
    FORMULA_FUNCTIONS,
    formulaRefNotAllowed,
    formulaSignature,
    type FormulaCategory,
    type FormulaFunctionDef,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { FIELD_TYPE_CATALOG } from '@/lib/fieldTypeCatalog';
import { FIELD_TYPE_ICONS } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { fold } from './formulaEditing';

/**
 * Fórmulas (A1) — referencia de funciones (con su firma, ayuda y un ejemplo)
 * y de los campos de la lista. Tocar una función o un campo lo inserta en el
 * cursor: en el celular es la forma cómoda de armar una fórmula sin tipear
 * las llaves ni los nombres.
 */
interface Props {
    fields: FieldEntity[];
    excludeId?: number;
    onInsertFunction: (fn: FormulaFunctionDef) => void;
    onInsertField: (field: FieldEntity) => void;
}

type Tab = 'functions' | 'fields';
const CATEGORIES = Object.keys(FORMULA_CATEGORY_LABELS) as FormulaCategory[];

export function FormulaReference({ fields, excludeId, onInsertFunction, onInsertField }: Props): JSX.Element {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('functions');
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState<FormulaCategory | 'all'>('all');

    const functions = useMemo(() => {
        const q = fold(query.trim());
        return FORMULA_FUNCTIONS.filter((fn) => {
            if (category !== 'all' && fn.category !== category) return false;
            if (q === '') return true;
            return [fn.name, ...(fn.aliases ?? []), fn.description].some((t) => fold(t).includes(q));
        });
    }, [query, category]);

    const usableFields = useMemo(() => {
        const q = fold(query.trim());
        return fields
            .filter((f) => f.id !== excludeId)
            .filter((f) => q === '' || fold(f.label).includes(q) || f.slug.includes(q))
            .sort((a, b) => a.position - b.position);
    }, [fields, excludeId, query]);

    const typeLabel = (type: string): string => FIELD_TYPE_CATALOG.find((t) => t.slug === type)?.label ?? type;

    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border" data-formula-reference="">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-font-medium hover:imcrm-bg-accent/50"
            >
                <BookOpen className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                {__('Funciones y campos')}
                <span className="imcrm-text-muted-foreground imcrm-font-normal">{__('· toca uno para insertarlo')}</span>
                <ChevronDown className={cn('imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform', open && 'imcrm-rotate-180')} aria-hidden />
            </button>
            {open && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-p-2">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1" role="tablist">
                        {(['functions', 'fields'] as Tab[]).map((t) => (
                            <button
                                key={t}
                                type="button"
                                role="tab"
                                aria-selected={tab === t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    'imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                                    tab === t ? 'imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                )}
                            >
                                {t === 'functions' ? __('Funciones') : __('Campos')}
                            </button>
                        ))}
                    </div>
                    <div className="imcrm-relative">
                        <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" aria-hidden />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={tab === 'functions' ? __('Buscar una función…') : __('Buscar un campo…')}
                            className="imcrm-h-8 imcrm-pl-7 imcrm-text-xs"
                            aria-label={tab === 'functions' ? __('Buscar una función') : __('Buscar un campo')}
                        />
                    </div>
                    {tab === 'functions' && (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                            {(['all', ...CATEGORIES] as Array<FormulaCategory | 'all'>).map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setCategory(c)}
                                    aria-pressed={category === c}
                                    className={cn(
                                        'imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px]',
                                        category === c
                                            ? 'imcrm-border-primary/40 imcrm-bg-primary/10 imcrm-text-primary'
                                            : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                    )}
                                >
                                    {c === 'all' ? __('Todas') : FORMULA_CATEGORY_LABELS[c]}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="imcrm-max-h-72 imcrm-overflow-y-auto">
                        {tab === 'functions' ? (
                            functions.length === 0 ? (
                                <p className="imcrm-px-1 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">{__('Ninguna función coincide.')}</p>
                            ) : (
                                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border">
                                    {functions.map((fn) => (
                                        <li key={fn.name}>
                                            <button
                                                type="button"
                                                onClick={() => onInsertFunction(fn)}
                                                className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-0.5 imcrm-rounded imcrm-px-1.5 imcrm-py-2 imcrm-text-left hover:imcrm-bg-accent/60"
                                            >
                                                <span className="imcrm-font-mono imcrm-text-[12px] imcrm-font-semibold imcrm-text-primary">
                                                    {formulaSignature(fn)}
                                                </span>
                                                <span className="imcrm-text-[12px] imcrm-text-foreground/90">{fn.description}</span>
                                                <span className="imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">
                                                    {__('Ej.:')} {fn.example}
                                                    {fn.exampleResult ? ` → ${fn.exampleResult}` : ''}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : usableFields.length === 0 ? (
                            <p className="imcrm-px-1 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">{__('Ningún campo coincide.')}</p>
                        ) : (
                            <ul className="imcrm-flex imcrm-flex-col">
                                {usableFields.map((f) => {
                                    const Icon = FIELD_TYPE_ICONS[f.type];
                                    const blocked = formulaRefNotAllowed(f.type);
                                    return (
                                        <li key={f.id}>
                                            <button
                                                type="button"
                                                disabled={blocked !== null}
                                                title={blocked ?? undefined}
                                                onClick={() => onInsertField(f)}
                                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1.5 imcrm-text-left imcrm-text-[12.5px] hover:imcrm-bg-accent/60 disabled:imcrm-cursor-not-allowed disabled:imcrm-opacity-50"
                                            >
                                                {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />}
                                                <span className="imcrm-truncate">{f.label}</span>
                                                <span className="imcrm-ml-auto imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">
                                                    {blocked ? __('no se puede usar') : typeLabel(f.type)}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
