/**
 * Por qué no se pudo leer una planilla. El `code` lo usa la interfaz; el
 * mensaje ya está escrito para la persona que subió el archivo.
 */
export type XlsxErrorCode =
    /** No es un .xlsx (ni siquiera un zip). */
    | 'not_xlsx'
    /** Un .xls de Excel 97-2003, o un .xlsx protegido con contraseña (ambos son CFB, no zip). */
    | 'legacy_or_encrypted'
    /** Pasa de los topes de tamaño (archivo, partes descomprimidas, filas). */
    | 'too_large'
    /** Trae XML que una planilla nunca trae (DTD/entidades). */
    | 'unsafe'
    /** Zip o XML dañado. */
    | 'corrupt'
    /** No tiene hojas. */
    | 'no_sheets';

export class XlsxError extends Error {
    constructor(
        readonly code: XlsxErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'XlsxError';
    }
}
