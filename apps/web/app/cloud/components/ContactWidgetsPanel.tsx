import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertTriangle, ChevronRight, MessageCircle, Plus } from 'lucide-react';
import { widgetButtonIcon, widgetButtonLabel, type ContactWidgetDto } from '@imagina-base/shared';

import { useContactWidgets, useCreateContactWidget, useWidgetOptions } from '@/admin/widgets/useContactWidgets';
import { WidgetIconView } from '@/admin/widgets/WidgetIconView';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __, sprintf } from '@/lib/i18n';

/**
 * v0.1.394 (ADR-S99) — Ajustes → Widget de contacto: los botones flotantes
 * que la empresa pone en su sitio (WhatsApp, un formulario o la agenda en un
 * panel tipo chat, llamar, correo). Cada widget se edita en su página.
 */
export function ContactWidgetsPanel(): JSX.Element {
    const widgets = useContactWidgets();
    const [creating, setCreating] = useState(false);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="widgets-panel">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <p className="imcrm-max-w-2xl imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Un botón que queda fijo en una esquina de tu sitio. Al tocarlo, la persona elige cómo hablarte: WhatsApp, un formulario o tu agenda (que se abren ahí mismo, como un chat), llamarte o escribirte un correo. Lo que llenan queda como un registro en tu lista.')}
                </p>
                {!creating && (
                    <Button size="sm" onClick={() => setCreating(true)} data-testid="widgets-new" data-tour="widgets-new">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nuevo widget')}
                    </Button>
                )}
            </div>

            {creating && <NewWidgetForm onCancel={() => setCreating(false)} />}

            {widgets.isLoading && <div className="imcrm-h-24 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />}
            {widgets.isError && (
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {widgets.error instanceof Error ? widgets.error.message : __('No se pudieron cargar los widgets.')}
                </p>
            )}
            {widgets.data && widgets.data.length === 0 && !creating && (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-8 imcrm-text-center" data-testid="widgets-empty">
                    <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted">
                        <MessageCircle className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    </span>
                    <div>
                        <p className="imcrm-font-medium">{__('Todavía no tienes un widget')}</p>
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Arma uno en un minuto: tu WhatsApp, un formulario de contacto y tu agenda en un solo botón.')}
                        </p>
                    </div>
                    <Button size="sm" onClick={() => setCreating(true)}>
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Crear mi widget')}
                    </Button>
                </div>
            )}
            {widgets.data && widgets.data.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="widgets-list">
                    {widgets.data.map((w) => (
                        <WidgetRow key={w.id} widget={w} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function WidgetRow({ widget }: { widget: ContactWidgetDto }): JSX.Element {
    return (
        <li>
            <Link
                to={`/settings/widgets/${widget.id}`}
                className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 hover:imcrm-border-primary/40 hover:imcrm-bg-accent/40"
                data-testid="widgets-row"
            >
                <div className="imcrm-flex imcrm--space-x-1.5">
                    {widget.config.buttons.slice(0, 4).map((b) => (
                        <span
                            key={b.id}
                            className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border-2 imcrm-border-card imcrm-bg-muted imcrm-text-foreground/70"
                            title={widgetButtonLabel(b)}
                        >
                            <WidgetIconView icon={widgetButtonIcon(b)} />
                        </span>
                    ))}
                    {widget.config.buttons.length === 0 && (
                        <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted">
                            <MessageCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        </span>
                    )}
                </div>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-truncate imcrm-font-medium">{widget.name}</p>
                    <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                        {widget.config.buttons.map((b) => widgetButtonLabel(b)).join(' · ') || __('Sin botones')}
                    </p>
                </div>
                {widget.problems.length > 0 && (
                    <span className="imcrm-hidden imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-warning sm:imcrm-inline-flex">
                        <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5" />
                        {widget.problems.length === 1 ? __('1 cosa por arreglar') : sprintf(__('%d cosas por arreglar'), widget.problems.length)}
                    </span>
                )}
                <Badge variant={widget.enabled ? 'success' : 'secondary'} dot>
                    {widget.enabled ? __('Publicado') : __('Sin publicar')}
                </Badge>
                <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
            </Link>
        </li>
    );
}

function NewWidgetForm({ onCancel }: { onCancel: () => void }): JSX.Element {
    const nav = useNavigate();
    const options = useWidgetOptions();
    const create = useCreateContactWidget();
    const [name, setName] = useState(__('Widget de contacto'));
    const [phone, setPhone] = useState('');
    const [formId, setFormId] = useState<string>('');
    const forms = options.data?.forms ?? [];

    const submit = (): void => {
        if (!name.trim()) return;
        create.mutate(
            {
                name: name.trim(),
                ...(phone.trim() ? { whatsapp_phone: phone.trim() } : {}),
                ...(formId ? { form_id: Number(formId) } : {}),
            },
            { onSuccess: (doc) => nav(`/settings/widgets/${doc.id}`) },
        );
    };

    return (
        <form
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
            onSubmit={(e) => {
                e.preventDefault();
                submit();
            }}
            data-testid="widgets-new-form"
        >
            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-new-name">{__('Nombre (sólo lo ves tú)')}</Label>
                    <Input id="w-new-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-new-phone">{__('Tu WhatsApp (opcional)')}</Label>
                    <Input id="w-new-phone" value={phone} placeholder="+57 300 123 4567" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label htmlFor="w-new-form">{__('Un formulario (opcional)')}</Label>
                    <Select id="w-new-form" value={formId} onChange={(e) => setFormId(e.target.value)}>
                        <option value="">{__('Ninguno por ahora')}</option>
                        {forms.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.name} · {f.list_name}
                                {f.enabled ? '' : ` (${__('sin publicar')})`}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            {create.isError && (
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {create.error instanceof Error ? create.error.message : __('No se pudo crear el widget.')}
                </p>
            )}
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                    {__('Cancelar')}
                </Button>
                <Button type="submit" size="sm" disabled={!name.trim() || create.isPending} data-testid="widgets-create">
                    {create.isPending ? __('Creando…') : __('Crear y diseñar')}
                </Button>
            </div>
        </form>
    );
}
