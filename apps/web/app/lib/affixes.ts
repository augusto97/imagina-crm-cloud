/**
 * Prefijo y sufijo de un número que ya viene FORMATEADO por su tipo de campo.
 *
 * El formateador de un porcentaje ya agrega «%» y el de una moneda su símbolo;
 * un widget o un bloque que además configura `suffix: '%'` o `prefix: '$'`
 * mostraba «37,5%%» o «$$ 1.200». Lo que el valor ya lleva no se repite: el
 * prefijo/sufijo configurado se descarta si el texto ya empieza/termina con él
 * (sin contar espacios).
 */
export function effectiveAffixes(formatted: string, prefix: string, suffix: string): { prefix: string; suffix: string } {
    const p = prefix.trim();
    const s = suffix.trim();
    const text = formatted.trim();
    return {
        prefix: p !== '' && text.startsWith(p) ? '' : prefix,
        suffix: s !== '' && text.endsWith(s) ? '' : suffix,
    };
}

/** El valor con su prefijo y sufijo, sin repetir lo que ya trae. */
export function withAffixes(formatted: string, prefix: string, suffix: string): string {
    const a = effectiveAffixes(formatted, prefix, suffix);
    return `${a.prefix}${formatted}${a.suffix}`;
}
