import { useEffect, useMemo, useState } from 'react';
import {
    CUSTOM_GUIDE_ID_RE,
    customGuideSchema,
    HELP_AUDIENCE_ROLES,
    HELP_CATEGORIES,
    HELP_SCREENS,
    helpSupportSchema,
    helpVideoEmbed,
    type CustomGuide,
    type HelpGuide,
    type PlatformHelp,
} from '@imagina-base/shared';
import { BookOpen, Check, EyeOff, LifeBuoy, Pencil, Plus, Search, Trash2, Video, X } from 'lucide-react';

import { RichLite } from '@/admin/help/RichLite';
import { useSystemGuides } from '@/admin/help/guideCatalog';
import { usePlatformHelp, useUpdatePlatformHelp } from '@/admin/help/useHelpData';
import { ROLE_LABELS } from '@/cloud/components/MemberControls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __, sprintf } from '@/lib/i18n';
import { foldText } from '@/lib/folderSections';
import { cn } from '@/lib/utils';

/**
 * Plataforma → Ayuda (fase 7): lo que el operador agrega al centro de ayuda
 * de TODAS las empresas — el contacto de soporte («¿Necesitas más ayuda?»),
 * un video por guía, ocultar guías que no aplican y guías propias.
 */
export function PlatformHelpCard(): JSX.Element {
    const q = usePlatformHelp();
    if (q.isError) return <p className="imcrm-text-sm imcrm-text-destructive">{String(q.error)}</p>;
    if (!q.data) {
        return (
            <Card>
                <CardContent className="imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</CardContent>
            </Card>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6" data-testid="platform-help">
            <SupportSection data={q.data} />
            <CustomGuidesSection data={q.data} />
            <SystemGuidesSection data={q.data} />
        </div>
    );
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function SectionHeader({ icon: Icon, title, badge, children }: { icon: typeof LifeBuoy; title: string; badge?: React.ReactNode; children: React.ReactNode }): JSX.Element {
    return (
        <CardHeader>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                </span>
                <CardTitle className="imcrm-flex-1">{title}</CardTitle>
                {badge}
            </div>
            <CardDescription>{children}</CardDescription>
        </CardHeader>
    );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-space-y-1">
            <Label htmlFor={id}>{label}</Label>
            {children}
            {error ? (
                <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>
            ) : (
                hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>
            )}
        </div>
    );
}

function Notice({ notice }: { notice: { kind: 'ok' | 'err'; text: string } | null }): JSX.Element | null {
    if (!notice) return null;
    return (
        <span role="status" className={notice.kind === 'ok' ? 'imcrm-text-sm imcrm-text-success' : 'imcrm-text-sm imcrm-text-destructive'}>
            {notice.text}
        </span>
    );
}

// ── Contacto de soporte ────────────────────────────────────────────────

function SupportSection({ data }: { data: PlatformHelp }): JSX.Element {
    const save = useUpdatePlatformHelp();
    const [form, setForm] = useState({
        email: data.support.email ?? '',
        whatsapp: data.support.whatsapp ?? '',
        url: data.support.url ?? '',
        note: data.support.note ?? '',
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const configured = Boolean(data.support.email || data.support.whatsapp || data.support.url);

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        setNotice(null);
        const blank = (v: string): string | null => (v.trim() === '' ? null : v.trim());
        const parsed = helpSupportSchema.safeParse({ email: blank(form.email), whatsapp: blank(form.whatsapp), url: blank(form.url), note: blank(form.note) });
        if (!parsed.success) {
            const next: Record<string, string> = {};
            for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
            setErrors(next);
            return;
        }
        setErrors({});
        save.mutate(
            { support: parsed.data },
            {
                onSuccess: () => setNotice({ kind: 'ok', text: __('Guardado. Ya aparece en la ayuda de todas las empresas.') }),
                onError: (err) => setNotice({ kind: 'err', text: errorText(err) }),
            },
        );
    };

    return (
        <Card data-testid="platform-help-support">
            <SectionHeader
                icon={LifeBuoy}
                title={__('Contacto de soporte')}
                badge={configured ? <Badge variant="success">{__('Visible')}</Badge> : <Badge variant="outline">{__('Oculto')}</Badge>}
            >
                {__('Aparece al final del panel de Ayuda como «¿Necesitas más ayuda?». Lo que dejes vacío no se muestra; sin ningún dato, la sección no aparece.')}
            </SectionHeader>
            <CardContent>
                <form className="imcrm-space-y-3" onSubmit={submit} noValidate>
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Field id="help-support-email" label={__('Correo de soporte')} error={errors.email}>
                            <Input id="help-support-email" type="email" value={form.email} onChange={set('email')} placeholder="soporte@tuempresa.com" data-testid="help-support-email" />
                        </Field>
                        <Field id="help-support-wa" label={__('WhatsApp')} hint={__('Con el indicativo del país.')} error={errors.whatsapp}>
                            <Input id="help-support-wa" value={form.whatsapp} onChange={set('whatsapp')} placeholder="+57 300 123 4567" data-testid="help-support-whatsapp" />
                        </Field>
                        <Field id="help-support-url" label={__('Centro de ayuda externo (opcional)')} hint={__('Una página tuya con más información (https://…).')} error={errors.url}>
                            <Input id="help-support-url" type="url" value={form.url} onChange={set('url')} placeholder="https://" data-testid="help-support-url" />
                        </Field>
                        <Field id="help-support-note" label={__('Nota (opcional)')} hint={__('Una línea: horario, tiempo de respuesta…')} error={errors.note}>
                            <Input id="help-support-note" value={form.note} onChange={set('note')} maxLength={240} placeholder={__('Lunes a viernes, de 8 a 6.')} />
                        </Field>
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={save.isPending} data-testid="help-support-save">
                            {__('Guardar')}
                        </Button>
                        <Notice notice={notice} />
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

// ── Guías propias ──────────────────────────────────────────────────────

function newGuideId(): string {
    let id = '';
    while (!CUSTOM_GUIDE_ID_RE.test(id)) id = `op-${Math.random().toString(36).slice(2, 10)}`;
    return id;
}

function emptyGuide(): CustomGuide {
    return { id: newGuideId(), title: '', category: 'start', minutes: 2, body: '', video_url: null, screens: [], roles: [] };
}

function CustomGuidesSection({ data }: { data: PlatformHelp }): JSX.Element {
    const save = useUpdatePlatformHelp();
    const confirm = useConfirm();
    const [editing, setEditing] = useState<CustomGuide | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const persist = (custom: CustomGuide[], okText: string, done?: () => void): void => {
        setNotice(null);
        save.mutate(
            { custom },
            {
                onSuccess: () => {
                    setNotice({ kind: 'ok', text: okText });
                    done?.();
                },
                onError: (err) => setNotice({ kind: 'err', text: errorText(err) }),
            },
        );
    };

    const onSave = (g: CustomGuide): void => {
        const exists = data.custom.some((c) => c.id === g.id);
        const next = exists ? data.custom.map((c) => (c.id === g.id ? g : c)) : [...data.custom, g];
        persist(next, exists ? __('Guía actualizada.') : __('Guía creada. Ya aparece en la ayuda.'), () => setEditing(null));
    };

    const onDelete = async (g: CustomGuide): Promise<void> => {
        const ok = await confirm({
            title: __('¿Eliminar esta guía?'),
            description: sprintf(__('«%s» deja de aparecer en la ayuda de todas las empresas.'), g.title),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        persist(
            data.custom.filter((c) => c.id !== g.id),
            __('Guía eliminada.'),
        );
    };

    return (
        <Card data-testid="platform-help-custom">
            <SectionHeader icon={BookOpen} title={__('Guías propias')} badge={<Badge variant="outline">{sprintf(__('%d de 60'), data.custom.length)}</Badge>}>
                {__('Guías tuyas que se suman a las de la app: cómo trabajar con tu soporte, un proceso de tus clientes… Puedes elegir en qué pantallas se sugieren y qué roles las ven.')}
            </SectionHeader>
            <CardContent className="imcrm-space-y-3">
                {data.custom.length === 0 && !editing && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no hay guías propias.')}</p>
                )}
                {data.custom.length > 0 && (
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                        {data.custom.map((g) => (
                            <li key={g.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2" data-testid={`help-custom-${g.id}`}>
                                <div className="imcrm-min-w-0 imcrm-flex-1">
                                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{g.title}</p>
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__(HELP_CATEGORIES.find((c) => c.id === g.category)?.label ?? '')}
                                        {' · '}
                                        {g.roles.length === 0 ? __('Todos los roles') : g.roles.map((r) => __(ROLE_LABELS[r] ?? r)).join(', ')}
                                        {g.video_url ? ` · ${__('con video')}` : ''}
                                    </p>
                                </div>
                                <Button type="button" variant="ghost" size="icon" aria-label={sprintf(__('Editar «%s»'), g.title)} onClick={() => setEditing(g)}>
                                    <Pencil className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" aria-label={sprintf(__('Eliminar «%s»'), g.title)} onClick={() => void onDelete(g)}>
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                {editing ? (
                    <CustomGuideForm
                        key={editing.id}
                        initial={editing}
                        isNew={!data.custom.some((c) => c.id === editing.id)}
                        saving={save.isPending}
                        onCancel={() => setEditing(null)}
                        onSave={onSave}
                    />
                ) : (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="imcrm-gap-1.5"
                        disabled={data.custom.length >= 60}
                        onClick={() => setEditing(emptyGuide())}
                        data-testid="help-custom-new"
                    >
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva guía')}
                    </Button>
                )}
                <Notice notice={notice} />
            </CardContent>
        </Card>
    );
}

function CustomGuideForm({
    initial,
    isNew,
    saving,
    onCancel,
    onSave,
}: {
    initial: CustomGuide;
    isNew: boolean;
    saving: boolean;
    onCancel: () => void;
    onSave: (g: CustomGuide) => void;
}): JSX.Element {
    const [g, setG] = useState<CustomGuide>(initial);
    const [video, setVideo] = useState(initial.video_url ?? '');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [preview, setPreview] = useState(false);
    const toggleIn = <T extends string>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        const parsed = customGuideSchema.safeParse({ ...g, video_url: video.trim() === '' ? null : video.trim() });
        if (!parsed.success) {
            const next: Record<string, string> = {};
            for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
            setErrors(next);
            return;
        }
        setErrors({});
        onSave(parsed.data);
    };

    return (
        <form onSubmit={submit} noValidate className="imcrm-space-y-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-testid="help-custom-form">
            <p className="imcrm-text-sm imcrm-font-semibold">{isNew ? __('Nueva guía') : __('Editar la guía')}</p>
            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-[1fr_200px_100px]">
                <Field id="help-custom-title" label={__('Título')} hint={__('Mejor como pregunta: «¿Cómo pido soporte?»')} error={errors.title}>
                    <Input id="help-custom-title" value={g.title} maxLength={140} onChange={(e) => setG({ ...g, title: e.target.value })} data-testid="help-custom-title" />
                </Field>
                <Field id="help-custom-cat" label={__('Categoría')}>
                    <Select id="help-custom-cat" value={g.category} onChange={(e) => setG({ ...g, category: e.target.value as CustomGuide['category'] })}>
                        {HELP_CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>
                                {__(c.label)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field id="help-custom-min" label={__('Minutos')} error={errors.minutes}>
                    <Input
                        id="help-custom-min"
                        type="number"
                        min={1}
                        max={60}
                        value={g.minutes}
                        onChange={(e) => setG({ ...g, minutes: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                    />
                </Field>
            </div>
            <Field id="help-custom-body" label={__('Contenido')} error={errors.body}>
                <div className="imcrm-mb-1 imcrm-inline-flex imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5" role="group" aria-label={__('Modo del editor')}>
                    {[
                        { on: !preview, label: __('Escribir'), set: false, testId: 'help-custom-write' },
                        { on: preview, label: __('Vista previa'), set: true, testId: 'help-custom-preview' },
                    ].map((b) => (
                        <button
                            key={b.testId}
                            type="button"
                            aria-pressed={b.on}
                            onClick={() => setPreview(b.set)}
                            data-testid={b.testId}
                            className={cn(
                                'imcrm-h-7 imcrm-rounded imcrm-px-2.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                                b.on ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            {b.label}
                        </button>
                    ))}
                </div>
                {preview ? (
                    <div className="imcrm-min-h-[160px] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-3">
                        {g.body.trim() === '' ? (
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Nada para mostrar todavía.')}</p>
                        ) : (
                            <RichLite text={g.body} />
                        )}
                    </div>
                ) : (
                    <Textarea
                        id="help-custom-body"
                        rows={8}
                        value={g.body}
                        maxLength={5000}
                        onChange={(e) => setG({ ...g, body: e.target.value })}
                        placeholder={'1. Abre **Ajustes**.\n2. Toca **Guardar**.\n\n> Un consejo al final.'}
                        className="imcrm-font-mono imcrm-text-xs"
                        data-testid="help-custom-body"
                    />
                )}
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Formato sencillo: «1. paso», «- viñeta», **negrita**, «> consejo» y [texto](https://…). Los enlaces a una pantalla de la app empiezan con «/» (p. ej. /settings?s=miembros).')}
                </p>
            </Field>
            <Field
                id="help-custom-video"
                label={__('Video (opcional)')}
                hint={__('Un enlace de YouTube, Vimeo o Loom: se muestra arriba de la guía.')}
                error={errors.video_url ?? (video.trim() !== '' && helpVideoEmbed(video) === null ? __('Pega un enlace de YouTube, Vimeo o Loom') : null)}
            >
                <Input id="help-custom-video" type="url" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
            </Field>
            <fieldset className="imcrm-space-y-1.5">
                <legend className="imcrm-text-sm imcrm-font-medium">{__('Sugerirla en estas pantallas')}</legend>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Aparece en «En esta pantalla» del panel de Ayuda. Sin ninguna, sólo por búsqueda y categoría.')}</p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1.5">
                    {HELP_SCREENS.map((s) => (
                        <label key={s.id} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                            <input type="checkbox" checked={g.screens.includes(s.id)} onChange={() => setG({ ...g, screens: toggleIn(g.screens, s.id) })} />
                            {__(s.label)}
                        </label>
                    ))}
                </div>
            </fieldset>
            <fieldset className="imcrm-space-y-1.5">
                <legend className="imcrm-text-sm imcrm-font-medium">{__('Quién la ve')}</legend>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin marcar ninguno, la ven todos los roles del equipo.')}</p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1.5">
                    {HELP_AUDIENCE_ROLES.map((r) => (
                        <label key={r} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                            <input
                                type="checkbox"
                                checked={g.roles.includes(r)}
                                onChange={() => setG({ ...g, roles: toggleIn(g.roles, r) })}
                                data-testid={`help-custom-role-${r}`}
                            />
                            {__(ROLE_LABELS[r] ?? r)}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button type="submit" size="sm" disabled={saving} className="imcrm-gap-1.5" data-testid="help-custom-save">
                    <Check className="imcrm-h-4 imcrm-w-4" />
                    {isNew ? __('Crear guía') : __('Guardar')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                    {__('Cancelar')}
                </Button>
            </div>
        </form>
    );
}

// ── Guías de la app: video y ocultar ───────────────────────────────────

function SystemGuidesSection({ data }: { data: PlatformHelp }): JSX.Element {
    const guides = useSystemGuides(true);
    const save = useUpdatePlatformHelp();
    const [videos, setVideos] = useState<Record<string, string>>(data.videos);
    const [hidden, setHidden] = useState<Set<string>>(() => new Set(data.hidden));
    const [filter, setFilter] = useState('');
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Si alguien más guardó, se toma lo del servidor (sin pisar lo que se edita).
    const serverKey = JSON.stringify([data.videos, data.hidden]);
    useEffect(() => {
        setVideos(data.videos);
        setHidden(new Set(data.hidden));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverKey]);

    const invalid = Object.entries(videos).filter(([, url]) => url.trim() !== '' && helpVideoEmbed(url) === null);
    const dirty =
        JSON.stringify(Object.entries(videos).filter(([, u]) => u.trim() !== '').sort()) !== JSON.stringify(Object.entries(data.videos).sort()) ||
        JSON.stringify([...hidden].sort()) !== JSON.stringify([...data.hidden].sort());

    const shown = useMemo(() => {
        if (!guides) return [];
        const q = foldText(filter).trim();
        return q === '' ? guides : guides.filter((g) => foldText(`${g.title} ${g.keywords ?? ''}`).includes(q));
    }, [guides, filter]);

    const submit = (): void => {
        if (invalid.length > 0) return;
        setNotice(null);
        const cleaned: Record<string, string> = {};
        for (const [id, url] of Object.entries(videos)) if (url.trim() !== '') cleaned[id] = url.trim();
        save.mutate(
            { videos: cleaned, hidden: [...hidden] },
            {
                onSuccess: () => setNotice({ kind: 'ok', text: __('Guardado.') }),
                onError: (err) => setNotice({ kind: 'err', text: errorText(err) }),
            },
        );
    };

    const videoCount = Object.values(data.videos).length;

    return (
        <Card data-testid="platform-help-system">
            <SectionHeader
                icon={Video}
                title={__('Guías de la app')}
                badge={
                    <span className="imcrm-flex imcrm-gap-1.5">
                        <Badge variant="outline">{sprintf(__('%d con video'), videoCount)}</Badge>
                        {data.hidden.length > 0 && <Badge variant="outline">{sprintf(__('%d ocultas'), data.hidden.length)}</Badge>}
                    </span>
                }
            >
                {__('Agrega un video a las guías que vienen con la app (se ve arriba de los pasos) u oculta las que no aplican a tus clientes. Las guías se actualizan con cada versión; lo que configures aquí se conserva.')}
            </SectionHeader>
            <CardContent className="imcrm-space-y-3">
                <label className="imcrm-relative imcrm-block imcrm-max-w-sm">
                    <span className="imcrm-sr-only">{__('Buscar una guía')}</span>
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" aria-hidden />
                    <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={__('Buscar una guía…')} className="imcrm-pl-8" data-testid="help-system-filter" />
                </label>
                {guides === null ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando las guías…')}</p>
                ) : (
                    <ul className="imcrm-max-h-[520px] imcrm-divide-y imcrm-divide-border imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                        {shown.map((g) => (
                            <SystemGuideRow
                                key={g.id}
                                guide={g}
                                video={videos[g.id] ?? ''}
                                hidden={hidden.has(g.id)}
                                onVideo={(url) => setVideos((v) => ({ ...v, [g.id]: url }))}
                                onHidden={(h) =>
                                    setHidden((prev) => {
                                        const next = new Set(prev);
                                        if (h) next.add(g.id);
                                        else next.delete(g.id);
                                        return next;
                                    })
                                }
                            />
                        ))}
                        {shown.length === 0 && <li className="imcrm-px-3 imcrm-py-3 imcrm-text-sm imcrm-text-muted-foreground">{__('Ninguna guía coincide.')}</li>}
                    </ul>
                )}
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button type="button" size="sm" disabled={!dirty || save.isPending || invalid.length > 0} onClick={submit} data-testid="help-system-save">
                        {__('Guardar')}
                    </Button>
                    {invalid.length > 0 && <span className="imcrm-text-sm imcrm-text-destructive">{__('Hay enlaces de video que no son de YouTube, Vimeo ni Loom.')}</span>}
                    <Notice notice={notice} />
                </div>
            </CardContent>
        </Card>
    );
}

function SystemGuideRow({
    guide,
    video,
    hidden,
    onVideo,
    onHidden,
}: {
    guide: HelpGuide;
    video: string;
    hidden: boolean;
    onVideo: (url: string) => void;
    onHidden: (hidden: boolean) => void;
}): JSX.Element {
    const bad = video.trim() !== '' && helpVideoEmbed(video) === null;
    const category = HELP_CATEGORIES.find((c) => c.id === guide.category);
    return (
        <li className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-px-3 imcrm-py-2.5 sm:imcrm-flex-row sm:imcrm-items-center', hidden && 'imcrm-bg-muted/40')} data-testid={`help-system-${guide.id}`}>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className={cn('imcrm-text-sm imcrm-font-medium', hidden && 'imcrm-text-muted-foreground imcrm-line-through')}>{guide.title}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{category ? __(category.label) : ''}</p>
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 sm:imcrm-w-[360px]">
                <div className="imcrm-relative imcrm-flex-1">
                    <Input
                        value={video}
                        onChange={(e) => onVideo(e.target.value)}
                        placeholder={__('Enlace de YouTube, Vimeo o Loom')}
                        aria-label={sprintf(__('Video de «%s»'), guide.title)}
                        aria-invalid={bad || undefined}
                        className={cn('imcrm-h-8 imcrm-pr-7 imcrm-text-xs', bad && 'imcrm-border-destructive')}
                        data-testid={`help-video-${guide.id}`}
                    />
                    {video.trim() !== '' && !bad && <Check className="imcrm-absolute imcrm-right-2 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-success" aria-label={__('Enlace válido')} />}
                    {bad && <X className="imcrm-absolute imcrm-right-2 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-destructive" aria-label={__('Enlace no válido')} />}
                </div>
                <label className="imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" title={__('No mostrar esta guía')}>
                    <input type="checkbox" checked={hidden} onChange={(e) => onHidden(e.target.checked)} data-testid={`help-hide-${guide.id}`} />
                    <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Ocultar')}
                </label>
            </div>
        </li>
    );
}
