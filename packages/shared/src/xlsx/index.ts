/**
 * Planillas de Excel (.xlsx): lector para el import (corre en el navegador)
 * y escritor por streaming para el export (corre en el servidor). Sin más
 * dependencia que `fflate` (zip). Ver ADR-S38 (addendum v0.1.299).
 */
export * from './errors';
export * from './serial';
export * from './numfmt';
export { xmlEscape } from './xml';
export * from './reader';
export * from './import-table';
export * from './writer';
