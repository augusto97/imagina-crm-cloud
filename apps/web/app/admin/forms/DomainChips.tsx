import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { __ } from '@/lib/i18n';

import { cleanEmbedDomain } from './shareHelpers';

/** Un sitio por etiqueta: se agrega con Enter, coma o espacio; Retroceso borra el último. */
export function DomainChips({ value, onChange, testId, autoFocus = true, max = 50 }: { value: string[]; onChange: (v: string[]) => void; testId: string; autoFocus?: boolean; max?: number }): JSX.Element {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (autoFocus) input.current?.focus();
    }, [autoFocus]);
    const add = (raw: string): void => {
        const parts = raw.split(/[\s,;]+/).filter(Boolean);
        if (parts.length === 0) {
            setDraft('');
            return;
        }
        const next = [...value];
        const bad: string[] = [];
        for (const p of parts) {
            const d = cleanEmbedDomain(p);
            if (!d) bad.push(p);
            else if (!next.includes(d)) next.push(d);
        }
        if (next.length !== value.length) onChange(next.slice(0, max));
        setDraft(bad.join(' '));
        setError(bad.length ? __('«%s» no parece un sitio: escribe algo como tusitio.com.').replace('%s', bad[0]!) : null);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <div
                className="imcrm-flex imcrm-min-h-9 imcrm-cursor-text imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-py-1 focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring"
                onClick={() => input.current?.focus()}
            >
                {value.map((d) => (
                    <span key={d} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-py-0.5 imcrm-pl-2 imcrm-pr-1 imcrm-text-xs imcrm-font-medium" data-domain={d}>
                        {d}
                        <button
                            type="button"
                            aria-label={__('Quitar %s').replace('%s', d)}
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange(value.filter((x) => x !== d));
                            }}
                            className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-background hover:imcrm-text-foreground"
                        >
                            <X className="imcrm-h-3 imcrm-w-3" />
                        </button>
                    </span>
                ))}
                <input
                    ref={input}
                    value={draft}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (/[\s,;]/.test(v)) add(v);
                        else {
                            setDraft(v);
                            setError(null);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || (e.key === 'Tab' && draft.trim())) {
                            e.preventDefault();
                            add(draft);
                        } else if (e.key === 'Backspace' && !draft && value.length) {
                            onChange(value.slice(0, -1));
                        }
                    }}
                    onBlur={() => draft.trim() && add(draft)}
                    placeholder={value.length ? __('Agregar otro') : 'tusitio.com'}
                    aria-label={__('Sitios que pueden insertarlo')}
                    className="imcrm-h-7 imcrm-min-w-[120px] imcrm-flex-1 imcrm-bg-transparent imcrm-text-sm imcrm-outline-none"
                    data-testid={testId}
                />
            </div>
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </div>
    );
}
