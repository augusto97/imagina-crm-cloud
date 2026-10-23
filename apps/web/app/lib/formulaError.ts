/**
 * Fórmulas (A1) — el valor de una fórmula que dio error en una fila.
 *
 * El servidor manda `null` en el dato y el motivo aparte (`formula_errors`).
 * El adaptador (`lib/api.ts`) junta los dos en este valor, así cualquier
 * superficie que dibuja un valor (tabla, tarjetas, kanban, ficha) muestra
 * «#ERROR» con el motivo sin tener que recibir el registro entero.
 *
 * Se comporta como texto «#ERROR» si alguien lo convierte a texto y como
 * `null` si viaja de vuelta al servidor: nunca se guarda.
 */
export class FormulaErrorValue {
    constructor(readonly message: string) {}

    toString(): string {
        return '#ERROR';
    }

    toJSON(): null {
        return null;
    }
}

export function isFormulaError(value: unknown): value is FormulaErrorValue {
    return value instanceof FormulaErrorValue;
}
