import {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    HybridBinarizer,
    MultiFormatReader,
    RGBLuminanceSource,
} from '@zxing/library';

import type { FrameDecoder } from './decoder';

/**
 * H3 — Lector de respaldo en JavaScript (`@zxing/library`), para los
 * navegadores sin `BarcodeDetector`. Este módulo se carga a pedido (su propio
 * chunk): sólo lo baja quien abre el escáner en un navegador que lo necesita.
 *
 * Cada cuadro se dibuja en un canvas chico (≤ 720 px de ancho: el código se
 * sigue leyendo y cuesta mucho menos), se pasa a luminancia y se busca un
 * código con «intentar más fuerte» (los de barras del celular lo necesitan).
 */
const MAX_WIDTH = 720;

export function createZxingDecoder(): FrameDecoder {
    const reader = new MultiFormatReader();
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.PDF_417,
        BarcodeFormat.AZTEC,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    reader.setHints(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    return {
        engine: 'zxing',
        async decode(video) {
            if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return [];
            const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
            const w = Math.max(1, Math.round(video.videoWidth * scale));
            const h = Math.max(1, Math.round(video.videoHeight * scale));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            ctx.drawImage(video, 0, 0, w, h);
            const { data } = ctx.getImageData(0, 0, w, h);
            const lum = new Uint8ClampedArray(w * h);
            for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
                // Luminancia con el verde pesando doble (como zxing).
                lum[j] = (data[i]! + 2 * data[i + 1]! + data[i + 2]!) >> 2;
            }
            try {
                const result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h))));
                const text = result.getText();
                return text ? [text] : [];
            } catch {
                // NotFoundException (no hay código en el cuadro) y errores de lectura.
                return [];
            } finally {
                reader.reset();
            }
        },
    };
}
