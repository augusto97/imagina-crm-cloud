import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CreateShopInput,
    GenerateShopVariantsInput,
    GenerateShopVariantsResult,
    PlatformShopDto,
    PublicShopMeta,
    PublicShopProduct,
    ShopConfig,
    ShopCouponDto,
    ShopCouponInput,
    ShopDto,
    ShopOptions,
    ShopOrderPanelDto,
    ShopProductVariantsDto,
    ShopVariantProductDto,
    SuspendShopInput,
    UpdateShopInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.412 (ADR-S103) — Las tiendas de una lista. Las claves usan IDs
 * numéricos (regla de oro nº 7).
 */
export const shopKeys = {
    all: ['shops'] as const,
    forList: (listId: number) => ['shops', 'list', listId] as const,
    one: (id: number) => ['shops', id] as const,
    options: (id: number) => ['shops', id, 'options'] as const,
    order: (listId: number, recordId: number) => ['shop-order', listId, recordId] as const,
    platform: (tenantId: number) => ['platform-shops', tenantId] as const,
    products: (id: number, q: string) => ['shops', id, 'products', q] as const,
    variants: (id: number, productId: number, attrs: string) => ['shops', id, 'variants', productId, attrs] as const,
    coupons: (id: number) => ['shops', id, 'coupons'] as const,
};

/** v0.1.415 — Los cupones de la tienda con sus usos. */
export function useShopCoupons(id: number, enabled = true) {
    return useQuery({
        queryKey: shopKeys.coupons(id),
        queryFn: async () => (await api.get<ShopCouponDto[]>(`/shops/${id}/coupons`)).data,
        enabled: enabled && id > 0,
        staleTime: 15_000,
    });
}

export function useSaveShopCoupon(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ couponId, input }: { couponId: number | null; input: ShopCouponInput }) =>
            couponId === null
                ? (await api.post<ShopCouponDto>(`/shops/${id}/coupons`, input)).data
                : (await api.patch<ShopCouponDto>(`/shops/${id}/coupons/${couponId}`, input)).data,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: shopKeys.coupons(id) });
            // La primera vez se suman las columnas «Descuento» y «Cupón» a Pedidos.
            void qc.invalidateQueries({ queryKey: ['fields'] });
        },
    });
}

export function useDeleteShopCoupon(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (couponId: number) => {
            await api.delete(`/shops/${id}/coupons/${couponId}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: shopKeys.coupons(id) }),
    });
}

/** v0.1.414 — Los productos del catálogo para elegir a cuál crearle variantes. */
export function useShopProducts(id: number, q: string, enabled = true) {
    return useQuery({
        queryKey: shopKeys.products(id, q),
        queryFn: async () => (await api.get<ShopVariantProductDto[]>(`/shops/${id}/products?q=${encodeURIComponent(q)}`)).data,
        enabled: enabled && id > 0,
        staleTime: 10_000,
    });
}

/** v0.1.414 — Un producto con sus variantes, leídas con los atributos del editor (aunque no estén guardados). */
export function useShopProductVariants(id: number, productId: number | null, attributes: number[]) {
    const attrs = attributes.join(',');
    return useQuery({
        queryKey: shopKeys.variants(id, productId ?? 0, attrs),
        queryFn: async () => (await api.get<ShopProductVariantsDto>(`/shops/${id}/products/${productId}/variants?attributes=${attrs}`)).data,
        enabled: id > 0 && productId !== null && productId > 0,
    });
}

export function useGenerateShopVariants(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: GenerateShopVariantsInput & { product_id: number }) => {
            const { product_id, ...body } = input;
            return (await api.post<GenerateShopVariantsResult>(`/shops/${id}/products/${product_id}/variants`, body)).data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['shops', id, 'variants'] });
            void qc.invalidateQueries({ queryKey: ['shops', id, 'products'] });
            void qc.invalidateQueries({ queryKey: ['records'] });
        },
    });
}

export function useShops(listId: number | undefined) {
    return useQuery({
        queryKey: shopKeys.forList(listId ?? 0),
        // El adaptador desenvuelve `{ data }`.
        queryFn: async () => (await api.get<ShopDto[]>(`/shops?list_id=${listId}`)).data,
        enabled: listId !== undefined && listId > 0,
        staleTime: 15_000,
    });
}

export function useShop(id: number) {
    return useQuery({
        queryKey: shopKeys.one(id),
        queryFn: async () => (await api.get<ShopDto>(`/shops/${id}`)).data,
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
    });
}

/** Los campos de la lista, las personas y las otras tiendas, en un pedido. */
export function useShopOptions(id: number) {
    return useQuery({
        queryKey: shopKeys.options(id),
        queryFn: async () => (await api.get<ShopOptions>(`/shops/${id}/options`)).data,
        enabled: Number.isInteger(id) && id > 0,
        staleTime: 30_000,
    });
}

function store(qc: ReturnType<typeof useQueryClient>, doc: ShopDto): void {
    qc.setQueryData(shopKeys.one(doc.id), doc);
    qc.setQueryData<ShopDto[]>(shopKeys.forList(doc.list_id), (prev) =>
        prev ? (prev.some((s) => s.id === doc.id) ? prev.map((s) => (s.id === doc.id ? doc : s)) : [...prev, doc]) : prev,
    );
}

export function useCreateShop() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateShopInput) => (await api.post<ShopDto>('/shops', input)).data,
        onSuccess: (doc) => {
            store(qc, doc);
            // La tienda crea las listas de pedidos (y quizá un tablero).
            void qc.invalidateQueries({ queryKey: ['lists'] });
            void qc.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useUpdateShop(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateShopInput) => (await api.patch<ShopDto>(`/shops/${id}`, input)).data,
        onSuccess: (doc) => store(qc, doc),
    });
}

export function useRegenerateShop(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<ShopDto>(`/shops/${id}/regenerate`, {})).data,
        onSuccess: (doc) => store(qc, doc),
    });
}

export function useDeleteShop() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (shop: { id: number; list_id: number }) => {
            await api.delete(`/shops/${shop.id}`);
            return shop;
        },
        onSuccess: (shop) => {
            qc.removeQueries({ queryKey: shopKeys.one(shop.id) });
            void qc.invalidateQueries({ queryKey: shopKeys.forList(shop.list_id) });
            void qc.invalidateQueries({ queryKey: ['lists'] });
        },
    });
}

/** La vista previa con lo que se está editando (sin guardar). */
export async function fetchShopPreview(id: number, config: ShopConfig): Promise<{ meta: PublicShopMeta; products: PublicShopProduct[] }> {
    return (await api.post<{ meta: PublicShopMeta; products: PublicShopProduct[] }>(`/shops/${id}/preview`, { config })).data;
}

/** La dirección pública (`/api/v1/public/s/<token>`) completa, con el origen del código. */
export function shopPublicUrl(shop: Pick<ShopDto, 'public_path'>, origin?: string | null): string {
    return `${origin ?? window.location.origin}${shop.public_path}`;
}

// ── El pedido de un registro (panel de la ficha) ───────────────────────

export function useRecordShopOrder(listId: number | string | undefined, recordId: number | undefined, enabled = true) {
    return useQuery({
        queryKey: shopKeys.order(Number(listId) || 0, recordId ?? 0),
        queryFn: async () => (await api.get<ShopOrderPanelDto | null>(`/lists/${listId}/records/${recordId}/shop-order`)).data ?? null,
        enabled: enabled && !!listId && !!recordId,
        staleTime: 15_000,
        retry: false,
    });
}

export function useMarkShopOrderPaid(listId: number | string, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<ShopOrderPanelDto | null>(`/lists/${listId}/records/${recordId}/shop-order/mark-paid`, {})).data,
        onSuccess: (doc) => {
            qc.setQueryData(shopKeys.order(Number(listId) || 0, recordId), doc);
            void qc.invalidateQueries({ queryKey: shopKeys.order(Number(listId) || 0, recordId) });
            void qc.invalidateQueries({ queryKey: ['records'] });
        },
    });
}

// ── Plataforma ─────────────────────────────────────────────────────────

export function usePlatformShops(tenantId: number, enabled = true) {
    return useQuery({
        queryKey: shopKeys.platform(tenantId),
        queryFn: async () => (await api.get<PlatformShopDto[]>(`/platform/shops?tenant_id=${tenantId}`)).data,
        enabled: enabled && tenantId > 0,
    });
}

export function useSuspendPlatformShop(tenantId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number } & SuspendShopInput) => (await api.patch<PlatformShopDto[]>(`/platform/shops/${input.id}`, { suspended: input.suspended, reason: input.reason ?? null })).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: shopKeys.platform(tenantId) }),
    });
}
