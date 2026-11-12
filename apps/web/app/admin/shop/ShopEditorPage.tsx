import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Code2, CreditCard, Eye, EyeOff, Loader2, Moon, Package, Palette, ReceiptText, Send, ShieldCheck, ShoppingBag, SlidersHorizontal, Sun, UserRound, type LucideIcon } from 'lucide-react';
import { readShopConfig, shopProblems, type ShopConfig, type ShopDto, type ShopOptions, type ShopProblem, type ShopSection } from '@imagina-base/shared';

import {
    BuilderMobileNav,
    BuilderMobileTopBar,
    BuilderTopBar,
    InlineName,
    MobileBackBar,
    MoreMenu,
    PanelHeader,
    PublishSwitch,
    SaveButton,
    SettingsMobileIndex,
    SettingsNav,
    type BuilderMode,
    type MenuAction,
    type SettingsNavItem,
} from '@/admin/builder/BuilderShell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { __, sprintf } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

import { useEmbedOrigin } from '../forms/useEmbedOrigin';
import { CatalogPanel, CheckoutPanel, DesignPanel, OrdersPanel, PaymentPanel, PublishPanel, SellerPanel } from './ShopPanels';
import { ShopPreview } from './ShopPreview';
import { SHOP_EDITOR_SECTIONS, SHOP_SECTION_INFO, sameShopConfig, sectionsWithProblems, shopEditorSection, shopSectionSummary } from './shopEditor';
import { shopPublicUrl, useDeleteShop, useRegenerateShop, useShop, useShopOptions, useUpdateShop } from './useShops';

const SECTION_ICON: Record<ShopSection, LucideIcon> = {
    catalog: Package,
    design: Palette,
    payment: CreditCard,
    checkout: ReceiptText,
    seller: ShieldCheck,
    orders: UserRound,
    publish: Code2,
};

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground" data-testid="shop-editor">
            {children}
        </div>
    );
}

/**
 * v0.1.412 (ADR-S103) — El editor de una tienda, a pantalla completa (como el
 * del widget): a la izquierda las secciones (cada una dice cómo está), al
 * centro la elegida y a la derecha la tienda real con lo que se está
 * editando. En el celular: el índice, la sección y la vista previa en una
 * barra abajo.
 */
export function ShopEditorPage(): JSX.Element {
    const { shopId } = useParams();
    const nav = useNavigate();
    const id = Number(shopId);
    const shop = useShop(id);
    const options = useShopOptions(id);

    if (shop.isLoading || options.isLoading) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </div>
            </Shell>
        );
    }
    if (shop.isError || !shop.data || !options.data) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-p-6 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-text-destructive">{shop.error instanceof Error ? shop.error.message : __('No se pudo cargar la tienda.')}</p>
                    <Button variant="outline" size="sm" onClick={() => nav('/lists')}>
                        {__('Volver a las listas')}
                    </Button>
                </div>
            </Shell>
        );
    }
    return (
        <Shell>
            <Editor key={shop.data.id} shop={shop.data} options={options.data} />
        </Shell>
    );
}

function Editor({ shop, options }: { shop: ShopDto; options: ShopOptions }): JSX.Element {
    const nav = useNavigate();
    const confirm = useConfirm();
    const toast = useToast();
    const appTheme = useTheme();
    const narrow = useMediaQuery('(max-width: 1023px)');
    const wide = useMediaQuery('(min-width: 1280px)');

    const [params, setParams] = useSearchParams();
    const section = shopEditorSection(params.get('t'));
    const go = (s: ShopSection): void => {
        const p = new URLSearchParams(params);
        p.set('t', s);
        setParams(p, { replace: true });
    };

    const [name, setName] = useState(shop.name);
    const [config, setConfig] = useState<ShopConfig>(() => readShopConfig(shop.config));
    const saved = useRef({ name: shop.name, config: readShopConfig(shop.config) });
    const update = useUpdateShop(shop.id);
    const regenerate = useRegenerateShop(shop.id);
    const remove = useDeleteShop();

    const dirty = name.trim() !== saved.current.name || !sameShopConfig(config, saved.current.config);
    const { confirmLeave } = useUnsavedChangesGuard(dirty);

    const live = update.data ?? regenerate.data ?? shop;
    const priceField = options.fields.find((f) => f.id === config.catalog.price);
    const problems: ShopProblem[] = useMemo(
        () => shopProblems(config, { hasOrdersLists: live.orders !== null, priceFieldOk: !!priceField && (priceField.type === 'currency' || priceField.type === 'number') }),
        [config, live.orders, priceField],
    );
    const problemSections = useMemo(() => sectionsWithProblems(problems), [problems]);

    const [enabledView, setEnabledView] = useState<boolean | null>(null);
    const enabled = enabledView ?? live.enabled;
    const origin = useEmbedOrigin(live.embed_origin ?? null);
    const url = shopPublicUrl(live, origin);

    const save = (extra?: { enabled?: boolean }): void => {
        if (extra?.enabled !== undefined) setEnabledView(extra.enabled);
        update.mutate(
            { name: name.trim() || shop.name, config: config as unknown as Record<string, unknown>, ...(extra ?? {}) },
            {
                onSuccess: (doc) => {
                    const c = readShopConfig(doc.config);
                    saved.current = { name: doc.name, config: c };
                    setName(doc.name);
                    setConfig(c);
                    if (extra?.enabled === undefined) toast.success(__('Tienda guardada'));
                    else toast.success(extra.enabled ? __('Tienda publicada') : __('La tienda ya no está publicada'));
                },
                onError: (e) => toast.error(__('No se pudo guardar'), e instanceof Error ? e.message : undefined),
                onSettled: () => setEnabledView(null),
            },
        );
    };

    const togglePublish = (): void => {
        if (!enabled && problems.length > 0) {
            go('publish');
            setMobileSection('publish');
            toast.warning(__('Todavía no se puede publicar'), problems.length === 1 ? __('Falta una cosa: está en «Publicar».') : sprintf(__('Faltan %d cosas: están en «Publicar».'), problems.length));
            return;
        }
        save({ enabled: !enabled });
    };
    const close = async (): Promise<void> => {
        if (await confirmLeave()) nav(`/lists/${options.list.slug}/settings?s=tienda`);
    };

    const saveRef = useRef(save);
    saveRef.current = save;
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirtyRef.current) saveRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
    const [mobileSection, setMobileSection] = useState<ShopSection | null>(params.get('t') ? section : null);
    const openSection = (s: ShopSection): void => {
        go(s);
        setMobileTab('edit');
        setMobileSection(s);
    };

    const patch = (fn: (c: ShopConfig) => ShopConfig): void => setConfig(fn);
    const navItems: Array<SettingsNavItem<ShopSection>> = SHOP_EDITOR_SECTIONS.map((s) => ({
        id: s,
        label: __(SHOP_SECTION_INFO[s].label),
        icon: SECTION_ICON[s],
        group: __(SHOP_SECTION_INFO[s].group),
        summary: __(shopSectionSummary(s, config, { enabled, productsCount: options.products_count, ordersListName: live.orders?.list_name ?? null })),
        problem: problemSections.has(s),
    }));

    const body = (s: ShopSection): JSX.Element => {
        switch (s) {
            case 'catalog':
                return <CatalogPanel config={config} options={options} patch={patch} />;
            case 'design':
                return <DesignPanel config={config} options={options} patch={patch} />;
            case 'payment':
                return <PaymentPanel config={config} options={options} patch={patch} />;
            case 'checkout':
                return <CheckoutPanel config={config} options={options} patch={patch} />;
            case 'seller':
                return <SellerPanel config={config} patch={patch} />;
            case 'orders':
                return <OrdersPanel shop={live} />;
            case 'publish':
                return (
                    <PublishPanel
                        shop={live}
                        url={url}
                        enabled={enabled}
                        busy={update.isPending}
                        problems={problems}
                        onTogglePublish={togglePublish}
                        onFix={(p) => openSection(p.section)}
                        domains={config.allowed_domains}
                        onDomains={(allowed_domains) => patch((c) => ({ ...c, allowed_domains }))}
                        regenerating={regenerate.isPending}
                        onRegenerate={async () => {
                            const ok = await confirm({
                                title: __('¿Cambiar el enlace?'),
                                description: __('El enlace de ahora deja de funcionar: hay que volver a compartir el nuevo y pegar de nuevo el código en tu sitio.'),
                                confirmLabel: __('Cambiar el enlace'),
                            });
                            if (ok) regenerate.mutate(undefined, { onSuccess: () => toast.success(__('Enlace nuevo listo')) });
                        }}
                        deleting={remove.isPending}
                        onDelete={async () => {
                            const ok = await confirm({
                                title: sprintf(__('¿Eliminar «%s»?'), shop.name),
                                description: __('El enlace deja de funcionar. Los productos y los pedidos se quedan en sus listas.'),
                                confirmLabel: __('Eliminar'),
                                destructive: true,
                            });
                            if (!ok) return;
                            remove.mutate(
                                { id: shop.id, list_id: shop.list_id },
                                {
                                    onSuccess: () => nav(`/lists/${options.list.slug}/settings?s=tienda`),
                                    onError: (e) => toast.error(__('No se pudo eliminar'), e instanceof Error ? e.message : undefined),
                                },
                            );
                        }}
                    />
                );
        }
    };
    const header = (s: ShopSection, mobile = false): JSX.Element => (
        <PanelHeader icon={mobile ? undefined : SECTION_ICON[s]} title={__(SHOP_SECTION_INFO[s].title)} subtitle={__(SHOP_SECTION_INFO[s].hint)} testId="shop-panel-header" />
    );

    const nameInput = <InlineName value={name} onChange={setName} label={__('Nombre de la tienda')} testId="shop-name" />;
    const themeAction: MenuAction = { label: appTheme.resolved === 'dark' ? __('Modo claro') : __('Modo oscuro'), icon: appTheme.resolved === 'dark' ? Sun : Moon, onSelect: appTheme.toggle };
    const saveButton = <SaveButton dirty={dirty} busy={update.isPending && enabledView === null} onClick={() => save()} testId="shop-save" />;

    if (narrow) {
        const items: Array<BuilderMode<'edit' | 'preview'>> = [
            { id: 'edit', label: __('Editar'), icon: SlidersHorizontal, problem: problems.length > 0, testId: 'shop-tab-edit' },
            { id: 'preview', label: __('Vista previa'), icon: Eye, testId: 'shop-tab-preview' },
        ];
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
                <BuilderMobileTopBar
                    onClose={() => void close()}
                    name={nameInput}
                    published={enabled}
                    statusText={live.suspended ? __('Suspendida') : enabled ? __('Publicada') : __('Sin publicar')}
                    more={
                        <MoreMenu
                            testId="shop-more"
                            actions={[
                                { label: enabled ? __('Dejar de publicar') : __('Publicar'), icon: enabled ? EyeOff : Send, onSelect: togglePublish, testId: 'shop-publish-menu', disabled: live.suspended },
                                { label: __('Compartir'), icon: Code2, onSelect: () => openSection('publish') },
                                { ...themeAction, separated: true },
                            ]}
                        />
                    }
                    save={saveButton}
                />
                {mobileTab === 'edit' && mobileSection !== null && (
                    <MobileBackBar label={__('Tienda')} title={__(SHOP_SECTION_INFO[mobileSection].title)} onBack={() => setMobileSection(null)} testId="shop-section-back" />
                )}
                <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-bg-canvas">
                    {mobileTab === 'edit' &&
                        (mobileSection === null ? (
                            <SettingsMobileIndex
                                items={navItems}
                                onPick={(s) => openSection(s)}
                                testId="shop-section-index"
                                intro={
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
                                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary">
                                            <ShoppingBag className="imcrm-h-5 imcrm-w-5" />
                                        </span>
                                        <p className="imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">
                                            {__('Los productos son los registros de la lista. Elige cómo te pagan y cómo entregas, y publícala. Mírala en «Vista previa».')}
                                        </p>
                                    </div>
                                }
                            />
                        ) : (
                            <div className="imcrm-bg-card" data-testid="shop-section">
                                {header(mobileSection, true)}
                                {body(mobileSection)}
                            </div>
                        ))}
                    {mobileTab === 'preview' && (
                        <div className="imcrm-h-full">
                            <ShopPreview shopId={shop.id} config={config} compact />
                        </div>
                    )}
                </div>
                <BuilderMobileNav items={items} value={mobileTab} onChange={setMobileTab} />
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
            <BuilderTopBar
                kindIcon={ShoppingBag}
                kindLabel={__('Tienda')}
                onClose={() => void close()}
                name={nameInput}
                modes={null}
                actions={
                    <>
                        {wide ? <ThemeToggle compact /> : <MoreMenu testId="shop-more" actions={[themeAction]} />}
                        <PublishSwitch enabled={enabled} busy={update.isPending && enabledView !== null} onClick={togglePublish} testId="shop-publish-switch" compact={!wide} />
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn('imcrm-ml-1 imcrm-gap-1.5', section === 'publish' && 'imcrm-border-primary/40 imcrm-text-primary')}
                            onClick={() => openSection('publish')}
                            data-testid="shop-share"
                            title={__('Compartir la tienda')}
                        >
                            <Code2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {wide && <span>{__('Compartir')}</span>}
                        </Button>
                        {saveButton}
                    </>
                }
            />
            <div className={cn('imcrm-grid imcrm-min-h-0 imcrm-flex-1', wide ? 'imcrm-grid-cols-[240px_420px_minmax(0,1fr)]' : 'imcrm-grid-cols-[220px_380px_minmax(0,1fr)]')}>
                <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-card" data-testid="shop-sections">
                    <SettingsNav items={navItems} active={section} onPick={(s) => openSection(s)} label={__('Secciones de la tienda')} dense />
                </aside>
                <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-card" data-testid="shop-section">
                    {header(section)}
                    {body(section)}
                </aside>
                <div className="imcrm-min-h-0 imcrm-min-w-0">
                    <ShopPreview shopId={shop.id} config={config} />
                </div>
            </div>
        </div>
    );
}
