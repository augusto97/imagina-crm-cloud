/**
 * Fórmulas — catálogo de funciones (nombre, firma, ayuda y ejemplo).
 *
 * Es la ÚNICA lista: la usan el analizador (cantidad de argumentos), el
 * evaluador, el compilador a SQL del servidor, el autocompletado y la
 * referencia del editor. Los nombres no distinguen mayúsculas ni tildes
 * (`dias_entre` = `DÍAS_ENTRE`); los alias en inglés existen para quien
 * llega de otra herramienta (y para el asistente), pero la interfaz muestra
 * siempre el nombre en español.
 */

export type FormulaCategory = 'logica' | 'texto' | 'numeros' | 'fechas' | 'conversion';

export const FORMULA_CATEGORY_LABELS: Record<FormulaCategory, string> = {
    logica: 'Lógica',
    texto: 'Texto',
    numeros: 'Números',
    fechas: 'Fechas',
    conversion: 'Conversión',
};

export interface FormulaParam {
    name: string;
    optional?: boolean;
    /** El último parámetro se puede repetir (`SUMA(a, b, c, …)`). */
    repeat?: boolean;
}

export interface FormulaFunctionDef {
    name: string;
    aliases?: readonly string[];
    category: FormulaCategory;
    params: readonly FormulaParam[];
    minArgs: number;
    maxArgs: number;
    description: string;
    example: string;
    /** Qué devuelve el ejemplo (para la referencia). */
    exampleResult?: string;
}

const P = (name: string, extra: Partial<FormulaParam> = {}): FormulaParam => ({ name, ...extra });

// Armado en una función marcada como pura: las llamadas a `P(…)` del literal
// harían que el empaquetador conserve el catálogo en cualquier pantalla que
// importe algo de shared, aunque no use fórmulas.
export const FORMULA_FUNCTIONS: readonly FormulaFunctionDef[] = /* @__PURE__ */ (() => [
    // ── Lógica ──────────────────────────────────────────────────────────
    {
        name: 'SI',
        aliases: ['IF'],
        category: 'logica',
        params: [P('condición'), P('si_verdadero'), P('si_falso', { optional: true })],
        minArgs: 2,
        maxArgs: 3,
        description: 'Devuelve un valor si la condición se cumple y otro si no. Sin el tercer valor, queda vacío.',
        example: 'SI({Total} > 1000000, "Grande", "Chico")',
        exampleResult: '"Grande"',
    },
    {
        name: 'Y',
        aliases: ['AND'],
        category: 'logica',
        params: [P('condición'), P('condición', { repeat: true })],
        minArgs: 1,
        maxArgs: 30,
        description: 'Verdadero si TODAS las condiciones se cumplen.',
        example: 'Y({Pagada}, {Total} > 0)',
    },
    {
        name: 'O',
        aliases: ['OR'],
        category: 'logica',
        params: [P('condición'), P('condición', { repeat: true })],
        minArgs: 1,
        maxArgs: 30,
        description: 'Verdadero si AL MENOS UNA condición se cumple.',
        example: 'O({Estado} = "Vencida", {Saldo} > 0)',
    },
    {
        name: 'NO',
        aliases: ['NOT'],
        category: 'logica',
        params: [P('condición')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Invierte una condición: verdadero pasa a falso y al revés.',
        example: 'NO({Pagada})',
    },
    {
        name: 'SWITCH',
        aliases: ['CAMBIAR'],
        category: 'logica',
        params: [P('valor'), P('caso'), P('resultado'), P('…', { optional: true, repeat: true })],
        minArgs: 3,
        maxArgs: 61,
        description:
            'Compara un valor con varios casos y devuelve el resultado del que coincide. Un último valor suelto es el resultado si ninguno coincide.',
        example: 'SWITCH({Prioridad}, "Alta", 1, "Media", 2, 3)',
        exampleResult: '1',
    },
    {
        name: 'ESBLANCO',
        aliases: ['ISBLANK', 'ESVACIO'],
        category: 'logica',
        params: [P('valor')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Verdadero si el valor está vacío.',
        example: 'ESBLANCO({Fecha de pago})',
    },
    {
        name: 'SI.ERROR',
        aliases: ['IFERROR'],
        category: 'logica',
        params: [P('valor'), P('si_error')],
        minArgs: 2,
        maxArgs: 2,
        description: 'Devuelve el valor, o el segundo argumento si el valor da error (por ejemplo, una división por cero).',
        example: 'SI.ERROR({Pagado} / {Total}, 0)',
    },
    {
        name: 'BLANCO',
        aliases: ['BLANK'],
        category: 'logica',
        params: [],
        minArgs: 0,
        maxArgs: 0,
        description: 'Un valor vacío. Sirve para dejar la celda en blanco desde un SI.',
        example: 'SI({Total} = 0, BLANCO(), {Pagado} / {Total})',
    },
    {
        name: 'VERDADERO',
        aliases: ['TRUE'],
        category: 'logica',
        params: [],
        minArgs: 0,
        maxArgs: 0,
        description: 'El valor verdadero (también se puede escribir sin paréntesis).',
        example: 'SI({Activo} = VERDADERO, "Sí", "No")',
    },
    {
        name: 'FALSO',
        aliases: ['FALSE'],
        category: 'logica',
        params: [],
        minArgs: 0,
        maxArgs: 0,
        description: 'El valor falso (también se puede escribir sin paréntesis).',
        example: 'SI({Activo} = FALSO, "Inactivo", "Activo")',
    },

    // ── Texto ───────────────────────────────────────────────────────────
    {
        name: 'CONCATENAR',
        aliases: ['CONCAT', 'CONCATENATE'],
        category: 'texto',
        params: [P('texto'), P('texto', { repeat: true })],
        minArgs: 1,
        maxArgs: 50,
        description: 'Une varios textos en uno. También se puede usar el operador &.',
        example: 'CONCATENAR({Nombre}, " ", {Apellido})',
        exampleResult: '"Ana Gómez"',
    },
    {
        name: 'MAYUSC',
        aliases: ['UPPER', 'MAYUSCULAS'],
        category: 'texto',
        params: [P('texto')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Pasa el texto a mayúsculas.',
        example: 'MAYUSC({Ciudad})',
        exampleResult: '"BOGOTÁ"',
    },
    {
        name: 'MINUSC',
        aliases: ['LOWER', 'MINUSCULAS'],
        category: 'texto',
        params: [P('texto')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Pasa el texto a minúsculas.',
        example: 'MINUSC({Email})',
    },
    {
        name: 'IZQUIERDA',
        aliases: ['LEFT'],
        category: 'texto',
        params: [P('texto'), P('cantidad', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description: 'Los primeros caracteres del texto (uno si no se indica la cantidad).',
        example: 'IZQUIERDA({Código}, 3)',
        exampleResult: '"TCK"',
    },
    {
        name: 'DERECHA',
        aliases: ['RIGHT'],
        category: 'texto',
        params: [P('texto'), P('cantidad', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description: 'Los últimos caracteres del texto (uno si no se indica la cantidad).',
        example: 'DERECHA({Teléfono}, 4)',
    },
    {
        name: 'EXTRAER',
        aliases: ['MID', 'MED'],
        category: 'texto',
        params: [P('texto'), P('inicio'), P('cantidad')],
        minArgs: 3,
        maxArgs: 3,
        description: 'Un pedazo del texto: desde la posición de inicio (la primera es 1), tantos caracteres.',
        example: 'EXTRAER("PED-2026-0042", 5, 4)',
        exampleResult: '"2026"',
    },
    {
        name: 'LARGO',
        aliases: ['LEN'],
        category: 'texto',
        params: [P('texto')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Cuántos caracteres tiene el texto.',
        example: 'LARGO({Descripción corta})',
    },
    {
        name: 'CONTIENE',
        aliases: ['CONTAINS', 'INCLUYE'],
        category: 'texto',
        params: [P('texto_o_lista'), P('buscar')],
        minArgs: 2,
        maxArgs: 2,
        description:
            'Verdadero si el texto contiene lo buscado (sin distinguir mayúsculas). En una selección múltiple, si alguna de las opciones es la buscada.',
        example: 'CONTIENE({Etiquetas}, "VIP")',
    },
    {
        name: 'REEMPLAZAR',
        aliases: ['SUSTITUIR', 'SUBSTITUTE', 'REPLACE'],
        category: 'texto',
        params: [P('texto'), P('buscar'), P('reemplazo')],
        minArgs: 3,
        maxArgs: 4,
        description:
            'Cambia cada aparición de un texto por otro. Con cuatro argumentos (texto, inicio, cantidad, nuevo) reemplaza por posición, como en Excel.',
        example: 'REEMPLAZAR({Teléfono}, " ", "")',
    },
    {
        name: 'ESPACIOS',
        aliases: ['TRIM', 'RECORTAR'],
        category: 'texto',
        params: [P('texto')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Quita los espacios del principio y del final, y deja uno solo entre palabras.',
        example: 'ESPACIOS({Nombre})',
    },
    {
        name: 'REGEX_COINCIDE',
        aliases: ['REGEX_MATCH', 'REGEX'],
        category: 'texto',
        params: [P('texto'), P('expresión'), P('ignorar_mayúsculas', { optional: true })],
        minArgs: 2,
        maxArgs: 3,
        description:
            'Verdadero si el texto COMPLETO cumple la expresión regular (hasta 200 caracteres). Las expresiones que podrían colgarse se rechazan.',
        example: 'REGEX_COINCIDE({Placa}, "[A-Z]{3}[0-9]{3}")',
    },

    // ── Números ─────────────────────────────────────────────────────────
    {
        name: 'REDONDEAR',
        aliases: ['ROUND'],
        category: 'numeros',
        params: [P('número'), P('decimales', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description: 'Redondea al número de decimales indicado (0 si no se indica). Con decimales negativos redondea a decenas, centenas…',
        example: 'REDONDEAR({Total} * 1.19, -2)',
    },
    {
        name: 'REDONDEAR.MAS',
        aliases: ['ROUNDUP', 'REDONDEAR.MÁS'],
        category: 'numeros',
        params: [P('número'), P('decimales', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description: 'Redondea siempre hacia arriba (alejándose de cero).',
        example: 'REDONDEAR.MAS({Horas}, 0)',
    },
    {
        name: 'REDONDEAR.MENOS',
        aliases: ['ROUNDDOWN'],
        category: 'numeros',
        params: [P('número'), P('decimales', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description: 'Redondea siempre hacia abajo (acercándose a cero).',
        example: 'REDONDEAR.MENOS({Promedio}, 1)',
    },
    {
        name: 'ABS',
        category: 'numeros',
        params: [P('número')],
        minArgs: 1,
        maxArgs: 1,
        description: 'El valor absoluto (el número sin signo).',
        example: 'ABS({Diferencia})',
    },
    {
        name: 'MAX',
        category: 'numeros',
        params: [P('valor'), P('valor', { repeat: true })],
        minArgs: 1,
        maxArgs: 50,
        description: 'El mayor de los valores (también sirve con fechas). Los vacíos se ignoran.',
        example: 'MAX({Precio lista}, {Precio oferta})',
    },
    {
        name: 'MIN',
        category: 'numeros',
        params: [P('valor'), P('valor', { repeat: true })],
        minArgs: 1,
        maxArgs: 50,
        description: 'El menor de los valores (también sirve con fechas). Los vacíos se ignoran.',
        example: 'MIN({Fecha 1}, {Fecha 2})',
    },
    {
        name: 'SUMA',
        aliases: ['SUM'],
        category: 'numeros',
        params: [P('número'), P('número', { repeat: true })],
        minArgs: 1,
        maxArgs: 50,
        description: 'Suma los números. Los vacíos cuentan como cero.',
        example: 'SUMA({Subtotal}, {Envío}, {Impuestos})',
    },
    {
        name: 'PROMEDIO',
        aliases: ['AVERAGE'],
        category: 'numeros',
        params: [P('número'), P('número', { repeat: true })],
        minArgs: 1,
        maxArgs: 50,
        description: 'El promedio de los números que tienen valor (los vacíos no cuentan).',
        example: 'PROMEDIO({Nota 1}, {Nota 2}, {Nota 3})',
    },
    {
        name: 'ENTERO',
        aliases: ['INT'],
        category: 'numeros',
        params: [P('número')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Redondea hacia abajo al entero (ENTERO(-2.5) da -3).',
        example: 'ENTERO({Horas} / 8)',
    },
    {
        name: 'RESIDUO',
        aliases: ['MOD'],
        category: 'numeros',
        params: [P('número'), P('divisor')],
        minArgs: 2,
        maxArgs: 2,
        description: 'Lo que sobra de la división (con el signo del divisor, como en Excel).',
        example: 'RESIDUO({Unidades}, 12)',
    },
    {
        name: 'POTENCIA',
        aliases: ['POWER'],
        category: 'numeros',
        params: [P('base'), P('exponente')],
        minArgs: 2,
        maxArgs: 2,
        description: 'Eleva un número a una potencia. También se puede usar el operador ^.',
        example: 'POTENCIA(1 + {Tasa}, 12)',
    },

    // ── Fechas ──────────────────────────────────────────────────────────
    {
        name: 'HOY',
        aliases: ['TODAY'],
        category: 'fechas',
        params: [],
        minArgs: 0,
        maxArgs: 0,
        description: 'La fecha de hoy en la zona horaria de la empresa.',
        example: 'DIAS_ENTRE(HOY(), {Vence})',
    },
    {
        name: 'AHORA',
        aliases: ['NOW'],
        category: 'fechas',
        params: [],
        minArgs: 0,
        maxArgs: 0,
        description: 'La fecha y la hora de este momento.',
        example: 'AHORA()',
    },
    {
        name: 'DIAS_ENTRE',
        aliases: ['DATETIME_DIFF', 'DAYS', 'DIAS'],
        category: 'fechas',
        params: [P('inicio'), P('fin')],
        minArgs: 2,
        maxArgs: 2,
        description: 'Cuántos días hay del inicio al fin (negativo si el fin es anterior). Con fecha y hora cuenta los días del calendario de la empresa.',
        example: 'DIAS_ENTRE({Creado}, HOY())',
    },
    {
        name: 'MESES_ENTRE',
        aliases: ['MONTHS_BETWEEN'],
        category: 'fechas',
        params: [P('inicio'), P('fin')],
        minArgs: 2,
        maxArgs: 2,
        description: 'Cuántos meses COMPLETOS hay del inicio al fin.',
        example: 'MESES_ENTRE({Fecha de ingreso}, HOY())',
    },
    {
        name: 'SUMAR_DIAS',
        aliases: ['DATEADD_DAYS'],
        category: 'fechas',
        params: [P('fecha'), P('días')],
        minArgs: 2,
        maxArgs: 2,
        description: 'La fecha más (o menos, con un número negativo) una cantidad de días.',
        example: 'SUMAR_DIAS({Emitida}, 30)',
    },
    {
        name: 'SUMAR_MESES',
        aliases: ['EDATE'],
        category: 'fechas',
        params: [P('fecha'), P('meses')],
        minArgs: 2,
        maxArgs: 2,
        description: 'La fecha más una cantidad de meses. Si el día no existe en el mes de llegada, queda el último (31 de enero + 1 = 28 de febrero).',
        example: 'SUMAR_MESES({Inicio del contrato}, 12)',
    },
    {
        name: 'SUMAR_DIAS_HABILES',
        aliases: ['WORKDAY', 'DIAS_HABILES'],
        category: 'fechas',
        params: [P('fecha'), P('días')],
        minArgs: 2,
        maxArgs: 2,
        description: 'La fecha más una cantidad de días hábiles: salta sábados, domingos y festivos de Colombia (incluidos los que se corren al lunes y los de Semana Santa).',
        example: 'SUMAR_DIAS_HABILES({Radicado}, 15)',
    },
    {
        name: 'DIA_SEMANA',
        aliases: ['WEEKDAY', 'DIASEM'],
        category: 'fechas',
        params: [P('fecha'), P('tipo', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description: 'El día de la semana como número: con tipo 1 (o sin tipo) domingo = 1 … sábado = 7; con tipo 2, lunes = 1 … domingo = 7.',
        example: 'DIA_SEMANA({Fecha}, 2)',
    },
    {
        name: 'ANIO',
        aliases: ['AÑO', 'YEAR', 'ANO'],
        category: 'fechas',
        params: [P('fecha')],
        minArgs: 1,
        maxArgs: 1,
        description: 'El año de una fecha.',
        example: 'ANIO({Fecha de venta})',
    },
    {
        name: 'MES',
        aliases: ['MONTH'],
        category: 'fechas',
        params: [P('fecha')],
        minArgs: 1,
        maxArgs: 1,
        description: 'El mes de una fecha (1 a 12).',
        example: 'MES({Fecha de venta})',
    },
    {
        name: 'DIA',
        aliases: ['DAY'],
        category: 'fechas',
        params: [P('fecha')],
        minArgs: 1,
        maxArgs: 1,
        description: 'El día del mes de una fecha (1 a 31).',
        example: 'DIA({Cumpleaños})',
    },
    {
        name: 'FORMATO_FECHA',
        aliases: ['DATETIME_FORMAT'],
        category: 'fechas',
        params: [P('fecha'), P('formato', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description:
            'La fecha como texto. Sin formato, con el de la empresa. Partes: AAAA, AA, MMMM (octubre), MMM (oct), MM, M, DDDD (jueves), DDD (jue), DD, D, HH, hh, mm, ss y AMPM; lo que va entre [corchetes] sale tal cual.',
        example: 'FORMATO_FECHA({Vence}, "D de MMMM de AAAA")',
        exampleResult: '"23 de octubre de 2026"',
    },

    // ── Conversión ──────────────────────────────────────────────────────
    {
        name: 'TEXTO',
        aliases: ['TEXT', 'T'],
        category: 'conversion',
        params: [P('valor'), P('formato', { optional: true })],
        minArgs: 1,
        maxArgs: 2,
        description:
            'Convierte un valor en texto con los separadores de la empresa. Formato opcional para números ("#,##0.00", "0%", "$#,##0") o fechas ("DD/MM/AAAA").',
        example: 'TEXTO({Total}, "$#,##0")',
        exampleResult: '"$1.250.000"',
    },
    {
        name: 'VALOR',
        aliases: ['VALUE', 'NUMERO'],
        category: 'conversion',
        params: [P('texto')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Convierte un texto en número ("1.250.000" o "1,5" se leen bien).',
        example: 'VALOR({Monto en texto})',
    },
    {
        name: 'FECHA',
        aliases: ['DATE'],
        category: 'conversion',
        params: [P('año_o_texto'), P('mes', { optional: true }), P('día', { optional: true })],
        minArgs: 1,
        maxArgs: 3,
        description: 'Arma una fecha con año, mes y día, o la lee de un texto ("2026-10-23" o en el formato de la empresa).',
        example: 'FECHA(ANIO(HOY()), 12, 31)',
    },
    {
        name: 'LETRAS',
        aliases: ['EN_LETRAS'],
        category: 'conversion',
        params: [P('número')],
        minArgs: 1,
        maxArgs: 1,
        description: 'El número escrito en palabras.',
        example: 'LETRAS(125)',
        exampleResult: '"ciento veinticinco"',
    },
    {
        name: 'PESOS',
        aliases: ['EN_PESOS'],
        category: 'conversion',
        params: [P('monto')],
        minArgs: 1,
        maxArgs: 1,
        description: 'Un monto escrito en palabras, con pesos y centavos (para cuentas de cobro).',
        example: 'PESOS({Total})',
        exampleResult: '"un millón doscientos cincuenta mil pesos"',
    },
])();

/** Quita tildes y pasa a mayúsculas: `días_entre` → `DIAS_ENTRE`. */
export function normalizeFunctionName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
}

// Índice por nombre y alias, armado la primera vez que se pide: sin código
// suelto al cargar el módulo, así una pantalla que no usa fórmulas no carga
// el catálogo (tree-shaking).
let byName: Map<string, FormulaFunctionDef> | null = null;

/** La definición de una función por su nombre o alias, o `undefined`. */
export function findFormulaFunction(name: string): FormulaFunctionDef | undefined {
    if (!byName) {
        byName = new Map<string, FormulaFunctionDef>();
        for (const def of FORMULA_FUNCTIONS) {
            byName.set(normalizeFunctionName(def.name), def);
            for (const alias of def.aliases ?? []) byName.set(normalizeFunctionName(alias), def);
        }
    }
    return byName.get(normalizeFunctionName(name));
}

/** Firma legible: `SI(condición, si_verdadero, [si_falso])`. */
export function formulaSignature(def: FormulaFunctionDef): string {
    const parts = def.params.map((p) => {
        const name = p.repeat && p.name !== '…' ? `${p.name}, …` : p.name;
        return p.optional ? `[${name}]` : name;
    });
    return `${def.name}(${parts.join(', ')})`;
}
