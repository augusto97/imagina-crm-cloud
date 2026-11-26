import { relativeDateValueIssue } from '@imagina-base/shared';
import { AiToolError } from './registry';

/**
 * v0.1.469 — Cómo se escribe el valor de `between_relative` (fechas) en las
 * herramientas del asistente y del MCP: un preset, `{days, dir}` («próximos
 * 10 días», «hace más de 45 días») o un rango fijo. Un solo texto para que
 * todas las descripciones digan lo mismo.
 */
export const RELATIVE_DATE_AI_HELP =
    'between_relative (sólo fechas) lleva como value: un preset (today, yesterday, this_week, last_week, this_month, last_month, ' +
    'this_quarter, last_quarter, this_year, last_year, last_7_days, last_15_days, last_30_days, last_90_days, next_7_days, next_30_days, ' +
    'from_today, before_today); o CUALQUIER cantidad de días {days: N, dir: "next"} (los próximos N días: de hoy a hoy+N−1), ' +
    '{days: N, dir: "last"} (los últimos N días: de hoy−N+1 a hoy), {days: N, dir: "before"} (hace más de N días: antes de hoy−N; ' +
    'p. ej. «sin contacto hace más de 45 días») o {days: N, dir: "after"} (dentro de más de N días: después de hoy+N), con N entero de 1 a 3650 ' +
    'y «hoy» en la zona horaria de la empresa; o un rango fijo {from: "AAAA-MM-DD", to: "AAAA-MM-DD"}';

/**
 * Una regla `between_relative` con un valor que no sirve es un error
 * CORREGIBLE para el modelo (no se guarda algo que después daría un 400).
 */
export function assertRelativeDateRule(op: unknown, value: unknown, where: string): void {
    if (op !== 'between_relative') return;
    const issue = relativeDateValueIssue(value);
    if (issue) throw new AiToolError(`${where}: ${issue}`);
}
