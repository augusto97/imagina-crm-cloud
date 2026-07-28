/**
 * Embeds del editor de descripción (v0.1.135).
 *
 * Sólo se puede embeber lo que está en esta lista: cada proveedor declara qué
 * URLs reconoce y a qué URL de `<iframe>` se traducen. Un iframe apunta a un
 * origen que ejecuta su propio código dentro de nuestra página, así que la
 * puerta se abre por dominio conocido, nunca por lo que pegue el usuario.
 *
 * Se PERSISTE la URL original (la que pegó la persona) y el proveedor; la URL
 * de embed se deriva en cada render — si mañana un proveedor cambia su forma
 * de embeber, no hay que migrar documentos.
 */

export type EmbedProvider = 'youtube' | 'vimeo' | 'loom' | 'figma' | 'drive';

export interface ResolvedEmbed {
    provider: EmbedProvider;
    /** URL para el `src` del iframe. */
    src: string;
    /** Proporción sugerida (alto/ancho) del contenedor. */
    ratio: number;
}

/** Etiqueta humana del proveedor (la usa la UI). */
export const EMBED_PROVIDER_LABELS: Record<EmbedProvider, string> = {
    youtube: 'YouTube',
    vimeo: 'Vimeo',
    loom: 'Loom',
    figma: 'Figma',
    drive: 'Google Drive',
};

/**
 * Dominios que el `frame-src` del proxy tiene que permitir. Vive acá para que
 * la lista de la CSP y la del código no se separen (`deploy/`).
 */
export const EMBED_FRAME_HOSTS: readonly string[] = [
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://www.loom.com',
    'https://www.figma.com',
    'https://drive.google.com',
    'https://docs.google.com',
];

/**
 * `URL` es global en Node y en el navegador, pero el `lib` de este paquete es
 * ES2023 (sin DOM) a propósito — el shared no debe tocar el DOM. Se declara
 * acá lo mínimo que se usa, en vez de abrirle el DOM entero al paquete.
 */
interface ParsedUrl {
    protocol: string;
    hostname: string;
    pathname: string;
    searchParams: { get(key: string): string | null };
    toString(): string;
}
declare const URL: { new (input: string): ParsedUrl };

function parse(url: string): ParsedUrl | null {
    try {
        const u = new URL(url.trim());
        return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
    } catch {
        return null;
    }
}

/** `host` o cualquier subdominio suyo. */
function hostIs(u: ParsedUrl, host: string): boolean {
    return u.hostname === host || u.hostname.endsWith(`.${host}`);
}

/**
 * Traduce una URL pegada a su forma embebible, o `null` si el proveedor no
 * está en la lista (el editor entonces ofrece dejarla como enlace).
 */
export function resolveEmbed(raw: unknown): ResolvedEmbed | null {
    if (typeof raw !== 'string') return null;
    const u = parse(raw);
    if (u === null) return null;

    // ——— YouTube ———
    if (hostIs(u, 'youtube.com') || hostIs(u, 'youtube-nocookie.com') || hostIs(u, 'youtu.be')) {
        const id = hostIs(u, 'youtu.be')
            ? u.pathname.slice(1)
            : (u.searchParams.get('v')
                ?? /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname)?.[1]
                ?? '');
        const clean = /^[\w-]{6,20}$/.exec(id)?.[0];
        if (clean === undefined) return null;
        return { provider: 'youtube', src: `https://www.youtube.com/embed/${clean}`, ratio: 9 / 16 };
    }

    // ——— Vimeo ———
    if (hostIs(u, 'vimeo.com')) {
        const id = /^\/(?:video\/)?(\d{6,12})/.exec(u.pathname)?.[1];
        if (id === undefined) return null;
        return { provider: 'vimeo', src: `https://player.vimeo.com/video/${id}`, ratio: 9 / 16 };
    }

    // ——— Loom ———
    if (hostIs(u, 'loom.com')) {
        const id = /^\/(?:share|embed)\/([0-9a-f]{16,64})/i.exec(u.pathname)?.[1];
        if (id === undefined) return null;
        return { provider: 'loom', src: `https://www.loom.com/embed/${id}`, ratio: 9 / 16 };
    }

    // ——— Figma ———
    if (hostIs(u, 'figma.com')) {
        if (!/^\/(file|design|proto|board|slides)\//.test(u.pathname)) return null;
        return {
            provider: 'figma',
            src: `https://www.figma.com/embed?embed_host=imagina&url=${encodeURIComponent(u.toString())}`,
            ratio: 0.62,
        };
    }

    // ——— Google Drive / Docs / Sheets / Slides ———
    if (hostIs(u, 'drive.google.com')) {
        const id = /\/file\/d\/([\w-]{10,80})/.exec(u.pathname)?.[1];
        if (id === undefined) return null;
        return { provider: 'drive', src: `https://drive.google.com/file/d/${id}/preview`, ratio: 0.7 };
    }
    if (hostIs(u, 'docs.google.com')) {
        const m = /^\/(document|spreadsheets|presentation|forms)\/d\/(?:e\/)?([\w-]{10,120})/.exec(u.pathname);
        if (m === null) return null;
        return {
            provider: 'drive',
            src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`,
            ratio: 0.7,
        };
    }

    return null;
}
