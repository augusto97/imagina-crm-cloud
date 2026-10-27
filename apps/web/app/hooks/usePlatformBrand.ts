import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    PLATFORM_ICON_KEYS,
    platformBrandImageSchema,
    type PlatformBrand,
    type PlatformBrandImage,
    type PlatformIconSet,
    type UpdatePlatformBrandInput,
} from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { loadImageFile, loadImageUrl, renderIconPng, renderIconSourcePng, renderLogoPng } from '@/lib/brandAssets';

/** v0.1.327 — Plataforma → Marca (superadmin). */
export const platformBrandKey = ['platform', 'brand'] as const;

export function usePlatformBrandAdmin() {
    return useQuery({
        queryKey: platformBrandKey,
        queryFn: async (): Promise<PlatformBrand> => (await api.get<PlatformBrand>('/platform/brand')).data,
    });
}

export function useUpdatePlatformBrand() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdatePlatformBrandInput): Promise<PlatformBrand> =>
            (await api.put<PlatformBrand>('/platform/brand', input)).data,
        onSuccess: (data) => {
            qc.setQueryData(platformBrandKey, data);
            // El login, el riel y la pestaña de ESTA pantalla la usan al toque.
            useSession.getState().setPlatformBrand(data);
        },
    });
}

/** Sube un PNG ya generado. */
export async function uploadBrandPng(blob: Blob, name: string): Promise<PlatformBrandImage> {
    const boot = getBootData();
    const form = new FormData();
    form.append('file', new File([blob], name, { type: 'image/png' }));
    const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/platform/brand/images`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        body: form,
    });
    const payload = (await res.json().catch(() => null)) as unknown;
    const parsed = platformBrandImageSchema.safeParse(payload);
    if (!res.ok || !parsed.success) {
        const message = (payload as { message?: string } | null)?.message;
        throw new Error(message ?? `No se pudo subir la imagen (HTTP ${res.status})`);
    }
    return parsed.data;
}

/** El logo (cualquier formato) → PNG subido. */
export async function uploadLogo(file: File): Promise<string> {
    const img = await loadImageFile(file);
    return (await uploadBrandPng(await renderLogoPng(img), 'logo.png')).url;
}

async function uploadSizes(img: HTMLImageElement, background: string): Promise<PlatformIconSet> {
    const out: Partial<PlatformIconSet> = {};
    for (const key of PLATFORM_ICON_KEYS) {
        const blob = await renderIconPng(img, key, background);
        out[key] = (await uploadBrandPng(blob, `${key}.png`)).url;
    }
    return out as PlatformIconSet;
}

/** El ícono (cualquier formato) → el original de 512 y los siete tamaños subidos. */
export async function uploadIconSet(
    file: File,
    background: string,
): Promise<{ icon_source_url: string; icons: PlatformIconSet }> {
    return uploadIconSetFromImage(await loadImageFile(file), background);
}

async function uploadIconSetFromImage(
    img: HTMLImageElement,
    background: string,
): Promise<{ icon_source_url: string; icons: PlatformIconSet }> {
    const source = await uploadBrandPng(await renderIconSourcePng(img), 'icon-source.png');
    return { icon_source_url: source.url, icons: await uploadSizes(img, background) };
}

/**
 * v0.1.328 — Un logo casi cuadrado (un isotipo) también sirve de ícono: al
 * subirlo sin ícono propio, la app instalada deja de salir con el genérico.
 * Un logo apaisado no: dentro del cuadrado quedaría diminuto.
 */
export function isSquarish(img: HTMLImageElement): boolean {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return false;
    const ratio = w / h;
    return ratio >= 0.75 && ratio <= 1.34;
}

/** Sube el logo y, si es casi cuadrado y se pide, también lo usa como ícono. */
export async function uploadLogoMaybeIcon(
    file: File,
    iconBackground: string | null,
): Promise<{ logo_url: string; icon: { icon_source_url: string; icons: PlatformIconSet } | null }> {
    const img = await loadImageFile(file);
    const logo = (await uploadBrandPng(await renderLogoPng(img), 'logo.png')).url;
    const icon = iconBackground && isSquarish(img) ? await uploadIconSetFromImage(img, iconBackground) : null;
    return { logo_url: logo, icon };
}

/** El logo ya guardado como ícono (para quien lo subió antes de v0.1.328). */
export async function iconSetFromSavedImage(
    url: string,
    background: string,
): Promise<{ icon_source_url: string; icons: PlatformIconSet }> {
    return uploadIconSetFromImage(await loadImageUrl(url), background);
}

/** Vuelve a generar los tamaños desde el original guardado (cambió el color de fondo). */
export async function regenerateIconSet(sourceUrl: string, background: string): Promise<PlatformIconSet> {
    return uploadSizes(await loadImageUrl(sourceUrl), background);
}
