import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { List } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Editor del template del portal del cliente. El portal SPA renderiza
 * `list.settings.portal_template` (bloques heading/notice/static_text); acá
 * el admin los arma. Guarda vía PATCH de la lista preservando el resto de
 * `settings`. La estructura de bloque = `{ type, config }` — la misma que
 * consume el renderer del portal (versionado hacia adelante: tipos
 * desconocidos se ignoran).
 */

type BlockType = 'heading' | 'notice' | 'static_text';
interface EditorBlock {
    type: BlockType;
    title: string;
    text: string;
}

const BLOCK_LABELS: Record<BlockType, string> = {
    heading: 'Título',
    notice: 'Aviso',
    static_text: 'Texto',
};

export function PortalTemplateEditor({ list }: { list: List }): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [blocks, setBlocks] = useState<EditorBlock[]>(() => fromTemplate(list.settings));
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = useMutation({
        mutationFn: () =>
            api.updateList(list.slug, {
                // Preservamos el resto de settings; sólo tocamos portal_template.
                settings: { ...list.settings, portal_template: toTemplate(blocks) },
            }),
        onSuccess: () => {
            setSaved(true);
            setError(null);
            void qc.invalidateQueries({ queryKey: ['list', tenantId, list.slug] });
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'No se pudo guardar'),
    });

    const patch = (i: number, p: Partial<EditorBlock>) => {
        setSaved(false);
        setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
    };
    const add = (type: BlockType) => {
        setSaved(false);
        setBlocks((bs) => [...bs, { type, title: '', text: '' }]);
    };
    const remove = (i: number) => {
        setSaved(false);
        setBlocks((bs) => bs.filter((_b, idx) => idx !== i));
    };
    const move = (i: number, delta: number) => {
        setSaved(false);
        setBlocks((bs) => {
            const j = i + delta;
            if (j < 0 || j >= bs.length) return bs;
            const next = [...bs];
            [next[i], next[j]] = [next[j]!, next[i]!];
            return next;
        });
    };

    return (
        <div className="imcrm-mx-auto imcrm-max-w-2xl imcrm-space-y-4">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <div>
                    <h2 className="imcrm-text-sm imcrm-font-semibold">Template del portal</h2>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Lo que ve el cliente arriba de sus datos cuando entra con el magic link.
                    </p>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    {saved && <span className="imcrm-text-xs imcrm-text-emerald-600">Guardado ✓</span>}
                    <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                        Guardar
                    </Button>
                </div>
            </div>
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}

            <div className="imcrm-space-y-2">
                {blocks.map((b, i) => (
                    <div
                        key={i}
                        className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3"
                    >
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                            <span className="imcrm-rounded imcrm-bg-accent imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-accent-foreground">
                                {BLOCK_LABELS[b.type]}
                            </span>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-muted-foreground">
                                <button
                                    onClick={() => move(i, -1)}
                                    disabled={i === 0}
                                    aria-label="Subir"
                                    className="imcrm-px-1 disabled:imcrm-opacity-30"
                                >
                                    ↑
                                </button>
                                <button
                                    onClick={() => move(i, 1)}
                                    disabled={i === blocks.length - 1}
                                    aria-label="Bajar"
                                    className="imcrm-px-1 disabled:imcrm-opacity-30"
                                >
                                    ↓
                                </button>
                                <button
                                    onClick={() => remove(i)}
                                    aria-label="Quitar bloque"
                                    className="imcrm-px-1 hover:imcrm-text-destructive"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <Input
                            value={b.title}
                            onChange={(e) => patch(i, { title: e.target.value })}
                            placeholder={b.type === 'heading' ? 'Texto del título' : 'Título (opcional)'}
                            aria-label="Título del bloque"
                        />
                        {b.type !== 'heading' && (
                            <textarea
                                value={b.text}
                                onChange={(e) => patch(i, { text: e.target.value })}
                                placeholder="Contenido…"
                                aria-label="Contenido del bloque"
                                className="imcrm-h-20 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-2 imcrm-text-sm"
                            />
                        )}
                    </div>
                ))}
                {blocks.length === 0 && (
                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        Sin bloques. El portal mostrará sólo los datos del cliente.
                    </p>
                )}
            </div>

            <div className="imcrm-flex imcrm-gap-2">
                {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
                    <Button key={t} variant="ghost" size="sm" onClick={() => add(t)}>
                        + {BLOCK_LABELS[t]}
                    </Button>
                ))}
            </div>
        </div>
    );
}

/** Lee los bloques editables desde `settings.portal_template` (tolerante). */
function fromTemplate(settings: Record<string, unknown>): EditorBlock[] {
    const raw = settings['portal_template'];
    if (!Array.isArray(raw)) return [];
    const out: EditorBlock[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const type = (item as { type?: unknown }).type;
        if (type !== 'heading' && type !== 'notice' && type !== 'static_text') continue;
        const config = ((item as { config?: unknown }).config ?? item) as Record<string, unknown>;
        out.push({
            type,
            title: asStr(config['title']),
            text: asStr(config['text'] ?? config['html'] ?? config['message']),
        });
    }
    return out;
}

/** Serializa al shape `{ type, config }` que consume el renderer del portal. */
function toTemplate(blocks: EditorBlock[]): Array<Record<string, unknown>> {
    return blocks.map((b) => ({
        type: b.type,
        config:
            b.type === 'heading'
                ? { title: b.title }
                : { title: b.title, text: b.text },
    }));
}

function asStr(v: unknown): string {
    return typeof v === 'string' ? v : '';
}
