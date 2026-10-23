import { describe, expect, it } from 'vitest';

import {
    checkStoredFormula,
    computedToFormula,
    evaluateRowFormulas,
    findFormulaFunction,
    formulaDependencies,
    formulaDisplayConfig,
    formulaRefIds,
    formulaRefNotAllowed,
    formulasDependingOn,
    formulaToDisplay,
    formulaToStored,
    FormulaSyntaxError,
    inferFormulaResultType,
    parseFormula,
    prepareFormula,
    remapFormulaRefs,
    type FormulaEnv,
    type FormulaEvalField,
} from './index';

/** Una lista de ejemplo: los campos de una factura. */
const FIELDS: Array<FormulaEvalField & { slug: string; label: string }> = [
    { id: 1, slug: 'precio', label: 'Precio', type: 'currency', config: { currency: 'COP', precision: 0 } },
    { id: 2, slug: 'cantidad', label: 'Cantidad', type: 'number', config: {} },
    { id: 3, slug: 'cliente', label: 'Cliente', type: 'text', config: {} },
    {
        id: 4,
        slug: 'estado',
        label: 'Estado',
        type: 'select',
        config: { options: [{ value: 'pagada', label: 'Pagada' }, { value: 'pendiente', label: 'Pendiente' }] },
    },
    { id: 5, slug: 'emitida', label: 'Emitida', type: 'date', config: {} },
    { id: 6, slug: 'vence', label: 'Vence', type: 'date', config: {} },
    { id: 7, slug: 'pagada', label: 'Pagada?', type: 'checkbox', config: {} },
    { id: 8, slug: 'creado', label: 'Creado', type: 'created_at', config: {} },
    { id: 9, slug: 'etiquetas', label: 'Etiquetas', type: 'multi_select', config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'nuevo', label: 'Nuevo' }] } },
    { id: 10, slug: 'avance', label: 'Avance', type: 'percent', config: {} },
    { id: 11, slug: 'responsable', label: 'Responsable', type: 'user', config: {} },
];

const ENV: FormulaEnv = {
    now: new Date('2026-10-23T15:30:00Z'),
    timeZone: 'America/Bogota',
    numberFormat: 'dot_comma',
    dateFormat: 'dmy',
    timeFormat: 'h24',
    userName: (id) => (id === 3 ? 'Ana Gómez' : null),
};

const ROW: Record<number, unknown> = {
    1: 25000,
    2: 3,
    3: 'Acme S.A.S.',
    4: 'pagada',
    5: '2026-10-01',
    6: '2026-10-31',
    7: true,
    8: '2026-10-01T22:00:00.000Z',
    9: ['vip', 'nuevo'],
    10: 45,
    11: 3,
};

/** Evalúa una fórmula escrita por NOMBRE (como la escribe una persona). */
function calc(display: string, opts: { row?: Record<number, unknown>; result_type?: string; extra?: FormulaEvalField[] } = {}): { value: unknown; error?: string } {
    const all = [...FIELDS, ...(opts.extra ?? [])];
    const stored = formulaToStored(display, all as never);
    if (!stored.ok) throw new Error(stored.error.message);
    const f: FormulaEvalField = {
        id: 100,
        type: 'formula',
        label: 'F',
        config: { formula: stored.stored, ...(opts.result_type ? { result_type: opts.result_type } : {}) },
    };
    const row = opts.row ?? ROW;
    const { values, errors } = evaluateRowFormulas([...all, f], (id) => row[id] ?? null, ENV);
    const error = errors.get(100);
    return error ? { value: null, error } : { value: values.get(100) };
}

const v = (display: string, opts?: Parameters<typeof calc>[1]): unknown => {
    const r = calc(display, opts);
    if (r.error) throw new Error(`Error inesperado: ${r.error}`);
    return r.value;
};

describe('parser', () => {
    it('respeta la precedencia de una hoja de cálculo', () => {
        expect(v('1 + 2 * 3')).toBe(7);
        expect(v('(1 + 2) * 3')).toBe(9);
        expect(v('2 ^ 3 ^ 2')).toBe(64); // izquierda a derecha, como Excel
        expect(v('-2 ^ 2')).toBe(4); // el signo va primero, como Excel
        expect(v('10 - 2 - 3')).toBe(5);
        expect(v('1 + 2 = 3')).toBe(true);
        expect(v('"a" & 1 + 2')).toBe('a3');
    });

    it('lee el porcentaje y el residuo', () => {
        expect(v('200 * 19%')).toBe(38);
        expect(v('10 % 3')).toBe(1);
        expect(v('50% - 0.25')).toBe(0.25);
        expect(v('-7 % 3')).toBe(2); // con el signo del divisor (como Excel)
    });

    it('acepta coma o punto y coma entre argumentos y nombres sin tildes', () => {
        expect(v('REDONDEAR(3.14159; 2)')).toBe(3.14);
        expect(v('redondear(3.14159, 2)')).toBe(3.14);
        expect(v('ANIO({Emitida})')).toBe(2026);
        expect(v('AÑO({Emitida})')).toBe(2026);
        expect(v('días_entre({Emitida}, {Vence})')).toBe(30);
    });

    it('dice dónde está el error', () => {
        const err = (text: string): FormulaSyntaxError => {
            try {
                parseFormula(text);
            } catch (e) {
                return e as FormulaSyntaxError;
            }
            throw new Error('no falló');
        };
        expect(err('SI({#1} > 0, "a", "b"').message).toMatch(/Falta un paréntesis de cierre \) para SI en la columna 22/);
        expect(err('(1 + 2').message).toMatch(/Falta un paréntesis de cierre \) en la columna 7/);
        expect(err('1 + ').message).toMatch(/termina antes de tiempo/);
        expect(err('1 2').message).toMatch(/Falta un operador o una coma antes de «2» en la columna 3/);
        expect(err('NOEXISTE(1)').message).toMatch(/La función «NOEXISTE» no existe en la columna 1/);
        expect(err('SI(1)').message).toMatch(/SI recibe entre 2 y 3 argumentos y tiene 1/);
        expect(err('"abc').message).toMatch(/Falta cerrar las comillas/);
        expect(err('{Precio').message).toMatch(/Falta cerrar la llave/);
        expect(err('Precio * 2').message).toMatch(/Los campos se escriben entre llaves: \{Precio\}/);
        expect(err('SI(1, 2,)').message).toMatch(/Sobra una coma/);
        const e = err('1 +\n(2');
        expect(e.message).toMatch(/en la línea 2, columna 3/);
    });

    it('pone topes de largo y profundidad', () => {
        expect(() => parseFormula('1+'.repeat(3000) + '1')).toThrow(/demasiado larga|demasiado grande/);
        expect(() => parseFormula('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/anida demasiado/);
    });
});

describe('referencias por nombre, guardadas por id', () => {
    it('traduce nombres a ids y vuelve', () => {
        const r = formulaToStored('{precio} * {CANTIDAD} + SI({Estado} = "Pagada", 0, 1)', FIELDS as never);
        expect(r.ok && r.stored).toBe('{#1} * {#2} + SI({#4} = "Pagada", 0, 1)');
        expect(r.ok && r.refs).toEqual([1, 2, 4]);
        expect(formulaToDisplay('{#1} * {#2}', FIELDS as never)).toBe('{Precio} * {Cantidad}');
    });

    it('renombrar un campo no rompe la fórmula', () => {
        const renamed = FIELDS.map((f) => (f.id === 1 ? { ...f, label: 'Precio unitario' } : f));
        expect(formulaToDisplay('{#1} * {#2}', renamed as never)).toBe('{Precio unitario} * {Cantidad}');
    });

    it('un campo en la papelera se muestra con su último nombre', () => {
        const without = FIELDS.filter((f) => f.id !== 1);
        expect(formulaToDisplay('{#1} * 2', without as never, { '1': 'Precio' })).toBe('{Precio} * 2');
        expect(formulaToDisplay('{#1} * 2', without as never)).toBe('{#1} * 2');
    });

    it('rechaza un nombre que no existe con su posición', () => {
        const r = formulaToStored('1 + {Precioo}', FIELDS as never);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error.message).toMatch(/No hay ningún campo «Precioo» .*columna 5/);
    });

    it('desempata nombres repetidos con el nombre interno', () => {
        const dup = [...FIELDS, { id: 50, slug: 'precio_2', label: 'Precio', type: 'number', config: {} }];
        const r = formulaToStored('{Precio}', dup as never);
        expect(!r.ok && r.error.message).toMatch(/\{precio\} o \{precio_2\}/);
        expect(formulaToDisplay('{#1} + {#50}', dup as never)).toBe('{precio} + {precio_2}');
    });

    it('un botón, una relación o un archivo no se pueden usar', () => {
        expect(formulaRefNotAllowed('button')).toMatch(/botón no tiene valor/);
        const withButton = [...FIELDS, { id: 70, slug: 'cobrar', label: 'Cobrar', type: 'button', config: {} }];
        const r = prepareFormula('{Cobrar} & "x"', withButton as never, null);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error.message).toMatch(/botón no tiene valor/);
    });

    it('re-mapea ids (plantillas, migración) sin tocar lo demás', () => {
        expect(remapFormulaRefs('SI({#1} > 0,\n  {#2} * 2, "x")', (id) => id + 100)).toBe('SI({#101} > 0,\n  {#102} * 2, "x")');
        expect(remapFormulaRefs('{#1} + {#9}', (id) => (id === 1 ? 7 : null))).toBe('{#7} + {#0}');
        expect(formulaRefIds('{#3} & {#3} & {#4}')).toEqual([3, 4]);
        expect(formulaDependencies({ formula: '{#3} + {#4}' })).toEqual([3, 4]);
    });
});

describe('operaciones', () => {
    it('cuentas con campos (moneda inferida)', () => {
        expect(v('{Precio} * {Cantidad}')).toBe(75000);
        const ty = inferFormulaResultType('{#1} * {#2}', { fields: new Map(FIELDS.map((f) => [f.id, f])) });
        expect(ty.type).toBe('currency');
        const disp = formulaDisplayConfig({ id: 100, type: 'formula', config: { formula: '{#1} * {#2}' } }, { fields: new Map(FIELDS.map((f) => [f.id, f])) });
        expect(disp).toEqual({ type: 'currency', config: { currency: 'COP', precision: 0 } });
    });

    it('un campo vacío cuenta como 0 en una cuenta y vacío en una comparación', () => {
        const row = { ...ROW, 2: null };
        expect(v('{Precio} * {Cantidad}', { row })).toBe(0);
        expect(v('{Precio} + {Cantidad}', { row })).toBe(25000);
        expect(v('{Cantidad} = 0', { row })).toBe(false);
        expect(v('ESBLANCO({Cantidad})', { row })).toBe(true);
        expect(v('{Vence} < HOY()', { row: { ...ROW, 6: null } })).toBe(false);
    });

    it('división por cero da #ERROR con el motivo (y SI.ERROR lo atrapa)', () => {
        expect(calc('{Precio} / ({Cantidad} - 3)').error).toBe('División por cero.');
        expect(v('SI.ERROR({Precio} / ({Cantidad} - 3), 0)')).toBe(0);
        expect(v('SI({Cantidad} = 3, 0, {Precio} / ({Cantidad} - 3))')).toBe(0);
    });

    it('lee las selecciones por su etiqueta, sin distinguir mayúsculas', () => {
        expect(v('{Estado}')).toBe('Pagada');
        expect(v('{Estado} = "pagada"')).toBe(true);
        expect(v('{Etiquetas}')).toBe('VIP, Nuevo');
        expect(v('CONTIENE({Etiquetas}, "vip")')).toBe(true);
        expect(v('{Responsable}')).toBe('Ana Gómez');
        expect(v('SI({Pagada?}, "Cobrada", "Por cobrar")')).toBe('Cobrada');
    });

    it('lógica', () => {
        expect(v('Y({Precio} > 0, {Cantidad} > 0)')).toBe(true);
        expect(v('O({Precio} > 100000, {Cantidad} > 10)')).toBe(false);
        expect(v('NO({Pagada?})')).toBe(false);
        expect(v('SWITCH({Estado}, "Pendiente", 1, "Pagada", 2, 9)')).toBe(2);
        expect(v('SWITCH("x", "a", 1, 9)')).toBe(9);
        expect(v('SWITCH("x", "a", 1)')).toBe(null);
        expect(v('SI(FALSO, 1)')).toBe(null);
        expect(v('VERDADERO')).toBe(true);
    });

    it('texto', () => {
        expect(v('CONCATENAR({Cliente}, " - ", {Estado})')).toBe('Acme S.A.S. - Pagada');
        expect(v('MAYUSC("bogotá")')).toBe('BOGOTÁ');
        expect(v('MINUSC("ÁRBOL")')).toBe('árbol');
        expect(v('IZQUIERDA("TCK-0001", 3)')).toBe('TCK');
        expect(v('DERECHA("TCK-0001", 4)')).toBe('0001');
        expect(v('IZQUIERDA("hola")')).toBe('h');
        expect(v('EXTRAER("PED-2026-0042", 5, 4)')).toBe('2026');
        expect(v('LARGO("ñandú")')).toBe(5);
        expect(v('REEMPLAZAR("300 111 2233", " ", "")')).toBe('3001112233');
        expect(v('REEMPLAZAR("abcdef", 2, 3, "X")')).toBe('aXef');
        expect(v('ESPACIOS("  hola    mundo  ")')).toBe('hola mundo');
        expect(v('"Total: " & {Precio}')).toBe('Total: 25000');
        expect(calc('IZQUIERDA("abc", -1)').error).toMatch(/negativa/);
    });

    it('REGEX_COINCIDE pasa por el análisis anti-ReDoS', () => {
        expect(v('REGEX_COINCIDE("ABC123", "[A-Z]{3}[0-9]{3}")')).toBe(true);
        expect(v('REGEX_COINCIDE("abc123", "[A-Z]{3}[0-9]{3}")')).toBe(false);
        expect(v('REGEX_COINCIDE("abc123", "[A-Z]{3}[0-9]{3}", VERDADERO)')).toBe(true);
        expect(calc('REGEX_COINCIDE("aaaa", "(a+)+$")').error).toMatch(/podría colgarse/);
        expect(calc('REGEX_COINCIDE("a(", "a(")').error).toMatch(/no es válida/);
    });

    it('números', () => {
        expect(v('REDONDEAR(2.5)')).toBe(3);
        expect(v('REDONDEAR(-2.5)')).toBe(-3);
        expect(v('REDONDEAR(1.005, 2)')).toBe(1.01);
        expect(v('REDONDEAR(1234567, -3)')).toBe(1235000);
        expect(v('REDONDEAR.MAS(1.1)')).toBe(2);
        expect(v('REDONDEAR.MAS(-1.1)')).toBe(-2);
        expect(v('REDONDEAR.MENOS(1.99, 1)')).toBe(1.9);
        expect(v('ABS(-4)')).toBe(4);
        expect(v('MAX(3, {Cantidad}, 1)')).toBe(3);
        expect(v('MIN(3, 7, 1)')).toBe(1);
        expect(v('SUMA(1, 2, 3)')).toBe(6);
        expect(v('PROMEDIO(1, 2, 6)')).toBe(3);
        expect(v('PROMEDIO({Cantidad}, 5)', { row: { ...ROW, 2: null } })).toBe(5);
        expect(v('ENTERO(-2.5)')).toBe(-3);
        expect(v('RESIDUO(10, 3)')).toBe(1);
        expect(v('RESIDUO(-10, 3)')).toBe(2);
        expect(v('POTENCIA(2, 10)')).toBe(1024);
        expect(v('0.1 + 0.2')).toBe(0.3);
        expect(calc('RESIDUO(1, 0)').error).toBe('División por cero.');
        expect(calc('POTENCIA(-8, 0.5)').error).toMatch(/negativo/);
        expect(calc('"abc" * 2').error).toMatch(/«abc» no es un número/);
    });

    it('fechas en la zona de la empresa', () => {
        expect(v('HOY()')).toBe('2026-10-23');
        expect(v('AHORA()')).toBe('2026-10-23T15:30:00.000Z');
        expect(v('DIAS_ENTRE({Emitida}, {Vence})')).toBe(30);
        expect(v('DIAS_ENTRE({Vence}, {Emitida})')).toBe(-30);
        // Creado a las 22:00 UTC del 1 = 17:00 del 1 en Bogotá.
        expect(v('DIA({Creado})')).toBe(1);
        expect(v('DIAS_ENTRE({Creado}, HOY())')).toBe(22);
        expect(v('MESES_ENTRE(FECHA(2026, 1, 31), FECHA(2026, 2, 28))')).toBe(0);
        expect(v('MESES_ENTRE(FECHA(2026, 1, 31), FECHA(2026, 3, 31))')).toBe(2);
        expect(v('MESES_ENTRE(FECHA(2026, 3, 31), FECHA(2026, 1, 31))')).toBe(-2);
        expect(v('SUMAR_DIAS({Emitida}, 30)')).toBe('2026-10-31');
        expect(v('{Emitida} + 30')).toBe('2026-10-31');
        expect(v('{Vence} - {Emitida}')).toBe(30);
        expect(v('SUMAR_MESES(FECHA(2026, 1, 31), 1)')).toBe('2026-02-28');
        expect(v('SUMAR_MESES(FECHA(2024, 1, 31), 1)')).toBe('2024-02-29');
        expect(v('DIA_SEMANA(FECHA(2026, 10, 23))')).toBe(6); // viernes (domingo = 1)
        expect(v('DIA_SEMANA(FECHA(2026, 10, 23), 2)')).toBe(5);
        expect(v('MES({Vence})')).toBe(10);
        expect(v('FORMATO_FECHA({Vence}, "D de MMMM de AAAA")')).toBe('31 de octubre de 2026');
        expect(v('FORMATO_FECHA({Vence}, "DDDD DD/MM/AA")')).toBe('sábado 31/10/26');
        expect(v('FORMATO_FECHA({Vence})')).toBe('31/10/2026');
        expect(v('FECHA(2026, 13, 1)')).toBe('2027-01-01');
        expect(v('FECHA("23/10/2026")')).toBe('2026-10-23');
        expect(v('{Vence} > HOY()')).toBe(true);
        expect(v('MAX({Emitida}, {Vence})')).toBe('2026-10-31');
        expect(v('SUMAR_DIAS({Creado}, 1)', { result_type: 'datetime' })).toBe('2026-10-02T22:00:00.000Z');
    });

    it('SUMAR_DIAS_HABILES salta fines de semana y festivos de Colombia', () => {
        // Jueves 15/10/2026 + 1 hábil = viernes 16.
        expect(v('SUMAR_DIAS_HABILES(FECHA(2026, 10, 15), 1)')).toBe('2026-10-16');
        // Viernes 9/10/2026 + 1 hábil: el lunes 12 es el Día de la Raza → martes 13.
        expect(v('SUMAR_DIAS_HABILES(FECHA(2026, 10, 9), 1)')).toBe('2026-10-13');
        // Semana Santa 2026: jueves 2 y viernes 3 de abril.
        expect(v('SUMAR_DIAS_HABILES(FECHA(2026, 4, 1), 1)')).toBe('2026-04-06');
        // Hacia atrás.
        expect(v('SUMAR_DIAS_HABILES(FECHA(2026, 10, 13), -1)')).toBe('2026-10-09');
        expect(v('SUMAR_DIAS_HABILES(FECHA(2026, 10, 10), 0)')).toBe('2026-10-10');
    });

    it('conversión con el formato de la empresa', () => {
        expect(v('TEXTO(1250000)')).toBe('1.250.000');
        expect(v('TEXTO(1250000.5, "#,##0.00")')).toBe('1.250.000,50');
        expect(v('TEXTO(1250000, "$#,##0")')).toBe('$1.250.000');
        expect(v('TEXTO(0.195, "0.0%")')).toBe('19,5%');
        expect(v('TEXTO(3.5, "0.##")')).toBe('3,5');
        expect(v('TEXTO({Vence}, "DD/MM/AAAA")')).toBe('31/10/2026');
        expect(v('VALOR("1.250.000")')).toBe(1250000);
        expect(v('VALOR("1,5")')).toBe(1.5);
        expect(calc('VALOR("abc")').error).toMatch(/no es un número/);
        expect(v('LETRAS(125)')).toBe('ciento veinticinco');
        expect(v('PESOS(1250000)')).toBe('un millón doscientos cincuenta mil pesos');
    });
});

describe('tipo de resultado', () => {
    it('se infiere y se puede elegir', () => {
        const map = new Map(FIELDS.map((f) => [f.id, f]));
        const t = (stored: string) => inferFormulaResultType(stored, { fields: map }).type;
        expect(t('{#1} * {#2}')).toBe('currency');
        expect(t('{#2} * 2')).toBe('number');
        expect(t('{#10} / 2')).toBe('percent');
        expect(t('{#3} & "x"')).toBe('text');
        expect(t('{#6}')).toBe('date');
        expect(t('{#8}')).toBe('datetime');
        expect(t('{#1} > 0')).toBe('checkbox');
        expect(t('DIAS_ENTRE({#5}, {#6})')).toBe('number');
        expect(t('SI({#7}, {#1}, 0)')).toBe('currency');
        expect(v('{Precio} * {Cantidad}', { result_type: 'text' })).toBe('75000');
        expect(v('"12"', { result_type: 'number' })).toBe(12);
        expect(calc('"doce"', { result_type: 'number' }).error).toMatch(/no es un número/);
        expect(v('{Cantidad} > 1', { result_type: 'checkbox' })).toBe(true);
    });
});

describe('fórmulas que usan fórmulas', () => {
    const extra: FormulaEvalField[] = [
        { id: 60, type: 'formula', label: 'Subtotal', config: { formula: '{#1} * {#2}' } },
        { id: 61, type: 'formula', label: 'IVA', config: { formula: '{#60} * 19%' } },
    ];

    it('se encadenan', () => {
        expect(v('{#60} + {#61}', { extra })).toBe(89250);
    });

    it('rechaza ciclos al guardar con el camino', () => {
        const fields = [...FIELDS, ...extra, { id: 62, type: 'formula', label: 'Total', config: { formula: '{#61} + 1' } }];
        const issue = checkStoredFormula('{#62} * 2', fields, 60);
        expect(issue?.message).toMatch(/en círculo: «Subtotal» → «Total» → «IVA» → «Subtotal»|en círculo/);
        expect(checkStoredFormula('{#1} * 2', fields, 60)).toBeNull();
        expect(checkStoredFormula('{#60} * 2', fields, 60)?.message).toMatch(/a sí misma/);
        expect(checkStoredFormula('{#999}', fields, null)?.message).toMatch(/ya no existe/);
    });

    it('un ciclo guardado igual (por datos viejos) da #ERROR en vez de colgarse', () => {
        const loop: FormulaEvalField[] = [
            { id: 70, type: 'formula', label: 'A', config: { formula: '{#71} + 1' } },
            { id: 71, type: 'formula', label: 'B', config: { formula: '{#70} + 1' } },
        ];
        const { errors } = evaluateRowFormulas([...FIELDS, ...loop], () => null, ENV);
        expect(errors.get(70)).toMatch(/círculo/);
    });

    it('encuentra las fórmulas que dependen de un campo (oculto o borrado)', () => {
        const fields = [...FIELDS, ...extra];
        expect([...formulasDependingOn(fields, new Set([1]))].sort()).toEqual([60, 61]);
        expect([...formulasDependingOn(fields, new Set([3]))]).toEqual([]);
    });

    it('un campo borrado se nombra en el error', () => {
        const f: FormulaEvalField = { id: 80, type: 'formula', label: 'X', config: { formula: '{#999} * 2', labels: { '999': 'Costo' } } };
        const { errors } = evaluateRowFormulas([...FIELDS, f], () => null, ENV);
        expect(errors.get(80)).toBe('El campo «Costo» no existe (está en la papelera o se borró).');
    });
});

describe('catálogo', () => {
    it('cada función tiene ayuda y un ejemplo que se lee sin errores de sintaxis', () => {
        for (const name of ['SI', 'Y', 'O', 'NO', 'SWITCH', 'ESBLANCO', 'CONCATENAR', 'MAYUSC', 'MINUSC', 'IZQUIERDA', 'DERECHA', 'EXTRAER', 'LARGO', 'REEMPLAZAR', 'ESPACIOS', 'REGEX_COINCIDE', 'REDONDEAR', 'REDONDEAR.MAS', 'REDONDEAR.MENOS', 'ABS', 'MAX', 'MIN', 'SUMA', 'PROMEDIO', 'ENTERO', 'RESIDUO', 'POTENCIA', 'HOY', 'AHORA', 'DIAS_ENTRE', 'MESES_ENTRE', 'SUMAR_DIAS', 'SUMAR_MESES', 'SUMAR_DIAS_HABILES', 'DIA_SEMANA', 'ANIO', 'MES', 'DIA', 'FORMATO_FECHA', 'TEXTO', 'VALOR', 'FECHA']) {
            const def = findFormulaFunction(name);
            expect(def, name).toBeDefined();
            expect(def!.description.length).toBeGreaterThan(10);
            expect(() => parseFormula(def!.example)).not.toThrow();
        }
    });
});

describe('convertir un calculado en fórmula', () => {
    it('arma la fórmula equivalente por nombre y da lo mismo', () => {
        const all = FIELDS as never;
        expect(computedToFormula({ operation: 'sum', inputs: [1, 2] }, all)).toBe('SUMA({Precio}, {Cantidad})');
        expect(v(computedToFormula({ operation: 'sum', inputs: [1, 2] }, all)!)).toBe(25003);
        expect(v(computedToFormula({ operation: 'product', inputs: [1, 2] }, all)!)).toBe(75000);
        expect(v(computedToFormula({ operation: 'subtract', inputs: [1, 2] }, all)!)).toBe(24997);
        expect(v(computedToFormula({ operation: 'divide', inputs: [2, 2] }, all)!)).toBe(1);
        expect(v(computedToFormula({ operation: 'abs', inputs: [2] }, all)!)).toBe(3);
        expect(v(computedToFormula({ operation: 'date_diff_days', inputs: [5, 6] }, all)!)).toBe(30);
        // Meses de calendario, como el calculado (no cuenta los días).
        expect(v(computedToFormula({ operation: 'date_diff_months', inputs: [5, 6] }, all)!)).toBe(0);
        expect(
            v(computedToFormula({ operation: 'date_diff_months', inputs: [5, 6] }, all)!, { row: { ...ROW, 5: '2025-12-31', 6: '2026-01-01' } }),
        ).toBe(1);
        expect(computedToFormula({ operation: 'concat', inputs: [3, 4], separator: ' "/" ' }, all)).toBe('CONCATENAR({Cliente}, " ""/"" ", {Estado})');
        expect(v(computedToFormula({ operation: 'concat', inputs: [3, 4], separator: ' - ' }, all)!)).toBe('Acme S.A.S. - Pagada');
    });

    it('sin lo necesario devuelve null', () => {
        expect(computedToFormula({ operation: 'sum', inputs: [] }, FIELDS as never)).toBeNull();
        expect(computedToFormula({ operation: 'subtract', inputs: [1] }, FIELDS as never)).toBeNull();
        expect(computedToFormula({ operation: 'otra', inputs: [1, 2] }, FIELDS as never)).toBeNull();
    });
});
