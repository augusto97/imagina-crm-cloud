import { useState } from 'react';
import { ArrowLeft, Eye, History, RotateCcw } from 'lucide-react';
import { AUTOMATION_SECRET_MARKER, type AutomationVersion } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useAutomationVersions } from '@/hooks/useAutomations';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import type { ActionMeta, ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { describeVersionChanges, summarizeAction, summarizeTrigger } from './automationMeta';

/**
 * v0.1.289 — Historial de versiones de una automatización. Cada guardado deja
 * una foto (sin secretos) con autor y fecha; aquí se ve qué cambió en cada
 * una, en lenguaje claro, y se puede abrir una en sólo lectura o
 * restaurarla.
 *
 * «Restaurar» NO guarda: carga esa versión en el editor para que la persona
 * la revise y la guarde (el guardado queda en el historial como «Restauró la
 * versión del …»). Los secretos no viajan en las versiones: al guardar, el
 * servidor conserva los actuales de cada paso.
 */
export function AutomationVersionsSheet({
    open,
    onOpenChange,
    listId,
    automationId,
    fields,
    lists,
    catalog,
    relationPaths,
    onRestore,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    automationId: number;
    fields: FieldEntity[];
    lists: ListSummary[];
    catalog: ActionMeta[];
    relationPaths?: Array<{ relation_field_id: number; relation_label: string; other_list_name: string }>;
    onRestore: (version: AutomationVersion) => void;
}): JSX.Element {
    const versions = useAutomationVersions(listId, automationId, open);
    const [viewing, setViewing] = useState<AutomationVersion | null>(null);
    const list = versions.data ?? [];

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) setViewing(null);
                onOpenChange(next);
            }}
        >
            <SheetContent className="imcrm-w-full sm:imcrm-w-[520px]" data-testid="imcrm-versions-sheet">
                <SheetHeader>
                    <div>
                        <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <History className="imcrm-h-4 imcrm-w-4" />
                            {viewing ? __('Versión guardada') : __('Versiones')}
                        </SheetTitle>
                        <SheetDescription>
                            {viewing
                                ? sprintf(__('Guardada el %s. Sólo lectura.'), formatDateTime(parseUtcDate(viewing.created_at)))
                                : __('Cada vez que se guarda queda una versión (se conservan las últimas 50). Puedes ver cualquiera o restaurarla.')}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton aria-label={__('Cerrar')} />
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {viewing ? (
                        <VersionView
                            version={viewing}
                            fields={fields}
                            lists={lists}
                            catalog={catalog}
                            relationPaths={relationPaths}
                            onBack={() => setViewing(null)}
                            onRestore={() => {
                                onRestore(viewing);
                                setViewing(null);
                                onOpenChange(false);
                            }}
                        />
                    ) : versions.isPending ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="imcrm-h-16 imcrm-animate-pulse imcrm-rounded-md imcrm-bg-muted/40" />
                            ))}
                        </div>
                    ) : versions.isError ? (
                        <p className="imcrm-text-sm imcrm-text-destructive">{(versions.error as Error).message}</p>
                    ) : list.length === 0 ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no hay versiones guardadas.')}</p>
                    ) : (
                        <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            {list.map((v, i) => {
                                const prev = list[i + 1];
                                const changes = describeVersionChanges(prev ? asLike(prev) : null, asLike(v), fields, lists, catalog);
                                return (
                                    <li key={v.id} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid="imcrm-version-row">
                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                            <span className="imcrm-text-sm imcrm-font-medium">{formatDateTime(parseUtcDate(v.created_at))}</span>
                                            {i === 0 && <Badge variant="success">{__('Actual')}</Badge>}
                                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                                {v.author ? sprintf(__('por %s'), v.author.name) : __('por el sistema')}
                                            </span>
                                        </div>
                                        {v.note && <p className="imcrm-text-xs imcrm-italic imcrm-text-muted-foreground">{v.note}</p>}
                                        <ul className="imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-0.5 imcrm-pl-4 imcrm-text-xs" data-testid="imcrm-version-changes">
                                            {changes.map((c, j) => (
                                                <li key={j}>{c}</li>
                                            ))}
                                        </ul>
                                        <div className="imcrm-flex imcrm-gap-2 imcrm-pt-1">
                                            <Button type="button" variant="outline" size="sm" className="imcrm-h-7 imcrm-gap-1" onClick={() => setViewing(v)} data-testid="imcrm-version-view">
                                                <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Ver')}
                                            </Button>
                                            {i > 0 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="imcrm-h-7 imcrm-gap-1"
                                                    onClick={() => {
                                                        onRestore(v);
                                                        onOpenChange(false);
                                                    }}
                                                    data-testid="imcrm-version-restore"
                                                >
                                                    <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Restaurar')}
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function asLike(v: AutomationVersion): {
    name: string;
    description: string | null;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    actions: ActionSpec[];
    is_active: boolean;
} {
    return {
        name: v.name,
        description: v.description,
        trigger_type: v.trigger_type,
        trigger_config: v.trigger_config,
        actions: v.actions as ActionSpec[],
        is_active: v.is_active,
    };
}

/** ¿La versión tiene secretos tapados? (se conservan los actuales al restaurar). */
export function versionHasSecrets(v: AutomationVersion): boolean {
    return JSON.stringify(v.actions).includes(AUTOMATION_SECRET_MARKER) || JSON.stringify(v.trigger_config).includes(AUTOMATION_SECRET_MARKER);
}

function VersionView({
    version,
    fields,
    lists,
    catalog,
    relationPaths,
    onBack,
    onRestore,
}: {
    version: AutomationVersion;
    fields: FieldEntity[];
    lists: ListSummary[];
    catalog: ActionMeta[];
    relationPaths?: Array<{ relation_field_id: number; relation_label: string; other_list_name: string }>;
    onBack: () => void;
    onRestore: () => void;
}): JSX.Element {
    const renderSteps = (steps: ActionSpec[], depth: number): JSX.Element => (
        <ol className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            {steps.map((s, i) => (
                <li key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1" style={{ marginLeft: depth * 14 }}>
                    <span className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs">
                        <span className="imcrm-mr-1 imcrm-font-semibold imcrm-text-muted-foreground">{i + 1}.</span>
                        {summarizeAction(s, fields, lists, catalog, relationPaths)}
                    </span>
                    {s.type === 'if_else' && (
                        <>
                            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-success" style={{ marginLeft: (depth + 1) * 14 }}>{__('Si se cumple')}</span>
                            {renderSteps(Array.isArray(s.config.then_actions) ? (s.config.then_actions as ActionSpec[]) : [], depth + 1)}
                            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-warning" style={{ marginLeft: (depth + 1) * 14 }}>{__('Si no')}</span>
                            {renderSteps(Array.isArray(s.config.else_actions) ? (s.config.else_actions as ActionSpec[]) : [], depth + 1)}
                        </>
                    )}
                    {s.type === 'for_each_linked' && renderSteps(Array.isArray(s.config.actions) ? (s.config.actions as ActionSpec[]) : [], depth + 1)}
                </li>
            ))}
        </ol>
    );
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-version-view-panel">
            <Button type="button" variant="ghost" size="sm" className="imcrm-w-fit imcrm-gap-1" onClick={onBack}>
                <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Volver a las versiones')}
            </Button>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-text-base imcrm-font-semibold">{version.name}</span>
                {version.description && <span className="imcrm-text-xs imcrm-text-muted-foreground">{version.description}</span>}
                <span className="imcrm-text-xs">{version.is_active ? __('Activa') : __('Pausada')}</span>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Cuando')}</span>
                <span className="imcrm-rounded-md imcrm-border imcrm-border-primary/25 imcrm-bg-card imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs">
                    {summarizeTrigger(version.trigger_type, version.trigger_config as TriggerConfig, fields)}
                </span>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Pasos')}</span>
                {renderSteps(version.actions as ActionSpec[], 0)}
            </div>
            {versionHasSecrets(version) && (
                <p className="imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Los secretos (claves, tokens, contraseñas) no se guardan en el historial: al restaurar se conservan los que tiene hoy cada paso.')}
                </p>
            )}
            <Button type="button" onClick={onRestore} className="imcrm-w-fit imcrm-gap-1.5" data-testid="imcrm-version-restore-view">
                <RotateCcw className="imcrm-h-4 imcrm-w-4" />
                {__('Restaurar esta versión')}
            </Button>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Restaurar la carga en el editor: revísala y guárdala para aplicarla. Hasta que guardes, no cambia nada.')}
            </p>
        </div>
    );
}
