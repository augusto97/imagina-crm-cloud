/**
 * H3 — Lector de códigos (QR y de barras) sobre un cuadro de video.
 *
 * Usa el `BarcodeDetector` NATIVO donde exista (Chrome en Android, macOS y
 * ChromeOS; rápido y sin descargar nada). Donde no (Chrome de Windows/Linux,
 * Firefox, Safari de iPhone), carga a pedido un lector en JavaScript
 * (`@zxing/library`) en su propio chunk: no suma peso a la carga inicial.
 */

/** Formatos que se piden al lector nativo (y que el de respaldo también lee). */
export const SCAN_FORMATS = [
    'qr_code',
    'ean_13',
    'ean_8',
    'upc_a',
    'upc_e',
    'code_128',
    'code_39',
    'code_93',
    'itf',
    'codabar',
    'data_matrix',
    'pdf417',
    'aztec',
] as const;

export interface FrameDecoder {
    /** Lee el cuadro actual: los códigos encontrados (vacío si ninguno). */
    decode(source: HTMLVideoElement): Promise<string[]>;
    readonly engine: 'native' | 'zxing';
}

interface NativeDetector {
    detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface NativeDetectorCtor {
    new (opts?: { formats?: string[] }): NativeDetector;
    getSupportedFormats?: () => Promise<string[]>;
}

async function nativeDecoder(win: Window): Promise<FrameDecoder | null> {
    const Ctor = (win as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (!Ctor) return null;
    try {
        const supported = (await Ctor.getSupportedFormats?.()) ?? [...SCAN_FORMATS];
        const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
        if (formats.length === 0) return null;
        const detector = new Ctor({ formats });
        return {
            engine: 'native',
            async decode(source) {
                const found = await detector.detect(source);
                return found.map((b) => b.rawValue).filter((v) => typeof v === 'string' && v !== '');
            },
        };
    } catch {
        return null;
    }
}

/**
 * El mejor lector disponible. `forceFallback` sirve para probar el lector en
 * JavaScript aunque exista el nativo.
 */
export async function createFrameDecoder(win: Window = window, forceFallback = false): Promise<FrameDecoder> {
    if (!forceFallback) {
        const native = await nativeDecoder(win);
        if (native) return native;
    }
    const { createZxingDecoder } = await import('./zxingDecoder');
    return createZxingDecoder();
}
