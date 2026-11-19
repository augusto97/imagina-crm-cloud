import { findSheetColumn, sameBulkValue, sheetSyncReadsSheet, sheetSyncWritesSheet, type Field, type SheetSyncConflict, type SheetSyncDryRun, type SheetSyncRowError, type SheetSyncSettings } from '@imagina-base/shared';
import type { SheetRowSnapshot } from '../db/schema';
import { normalizeKey } from '../records/record-key';
import { appCanon, cellCanon, cellToFieldValue, fieldValueToCell, rowFingerprint, type SheetCell, type SheetValueCtx } from './sheet-values';

/**
 * v0.1.459 (G3) — El PLAN de una corrida: qué cambia en la app y qué cambia
 * en la hoja. Puro (sin base ni red): lo usan la corrida y «Probar» con los
 * MISMOS datos, y se prueba aparte.
 *
 * Las reglas, por celda (columna ↔ campo de una fila ya emparejada):
 *  - «De la hoja a la app»: si la hoja dice otra cosa, la app toma el valor
 *    de la hoja.
 *  - «De la app a la hoja»: si la app dice otra cosa, se escribe la celda.
 *  - «En los dos sentidos»: se compara cada lado con lo ÚLTIMO que se
 *    sincronizó (el `snapshot` del vínculo). Lo que cambió de un solo lado
 *    viaja al otro; si cambió la MISMA celda en los dos, gana la app y queda
 *    anotado; si nada cambió desde la última vez, no se toca nada (así una
 *    fecha con el formato que eligió la persona en la planilla no se reescribe
 *    en cada corrida). La primera vez que se unen una fila y un registro (sin
 *    historia) gana el lado que tiene un valor; si los dos tienen y difieren,
 *    gana la app.
 *
 * Las comparaciones "¿son lo mismo?" se hacen leyendo la celda como valor
 * del campo (`cellToFieldValue` + `sameBulkValue`): «Activo» y el valor
 * `activo` de una selección son lo mismo, como «1.500» y 1500.
 */

/** Una columna mapeada, ya ubicada en la hoja (`index` -1 = no está). */
export interface PlanColumn {
    name: string;
    index: number;
    field: Field;
}

export interface SheetRowIn {
    /** Número de fila en la hoja (1 = la primera). */
    row: number;
    cells: unknown[];
}

export interface RecordIn {
    id: number;
    data: Record<string, unknown>;
}

export interface LinkIn {
    recordId: number;
    rowKey: string;
    snapshot: SheetRowSnapshot;
    fingerprint: string | null;
    removed: boolean;
    /** El registro está en la papelera de la app. */
    trashed: boolean;
}

export interface PlanInput {
    settings: Pick<SheetSyncSettings, 'direction' | 'key' | 'on_sheet_delete' | 'on_app_delete'>;
    /** Encabezados de la hoja (en orden de columna). */
    headers: string[];
    /** Columnas mapeadas (sin la clave en modo «ID de la app»). */
    columns: Array<{ name: string; field: Field }>;
    /** En modo «una columna de la hoja»: el campo clave. */
    keyField: Field | null;
    rows: SheetRowIn[];
    /** Registros vivos de la lista. */
    records: RecordIn[];
    links: LinkIn[];
    /** La hoja tenía más filas que el tope: lo de abajo no se lee (ni se da por borrado). */
    sheetTruncated: boolean;
    /** La lista tenía más registros que el tope: no se agregan los de más. */
    recordsTruncated: boolean;
    ctx: SheetValueCtx;
    /** Ejemplos para «Probar» (0 = ninguno). */
    sampleSize?: number;
}

export interface PlannedCreate {
    /** Fila de la hoja de donde sale. */
    row: number;
    /** Clave normalizada (modo campo) o `''` (modo ID: la pone la app al crear). */
    key: string;
    data: Record<string, unknown>;
    /** Lo sincronizado, para el vínculo. */
    snapshot: SheetRowSnapshot;
    fingerprint: string;
    /** Modo ID: escribir el número del registro en la columna clave. */
    writeId: boolean;
    /** Lo que tiene hoy la celda clave de esa fila (para comprobarla antes de escribir). */
    expectKey: string;
    /** El registro creado (lo completa la corrida al insertarlo). */
    recordId?: number;
}

export interface PlannedUpdate {
    recordId: number;
    where: string;
    before: Record<string, unknown>;
    patch: Record<string, unknown>;
}

export interface PlannedCellWrite {
    row: number;
    col: number;
    value: SheetCell;
    /** La clave que tiene que estar en esa fila al escribir (`''` = una fila sin clave). */
    expectKey: string;
    /** El registro del que sale el valor (para saber qué vínculo queda al día). */
    recordId: number;
}

export interface PlannedAppend {
    recordId: number;
    key: string;
    cells: SheetCell[];
    snapshot: SheetRowSnapshot;
    fingerprint: string;
}

export interface PlannedDelete {
    row: number;
    key: string;
    recordId: number;
}

/** Un vínculo a guardar: con lo sincronizado ANTES y DESPUÉS de escribir la hoja. */
export interface PlannedLink {
    recordId: number;
    rowKey: string;
    /** Si escribir en la hoja falla, esto queda: la próxima corrida lo reintenta. */
    snapshotBefore: SheetRowSnapshot;
    snapshotAfter: SheetRowSnapshot;
    fingerprint: string | null;
    removed: boolean;
    /** Este vínculo depende de escribir la hoja (sus celdas o su ID). */
    dependsOnSheet: boolean;
}

export interface SheetPlan {
    headerWrites: Array<{ col: number; name: string }>;
    /** Columnas que usa la hoja al terminar (para pedir columnas si faltan). */
    width: number;
    keyCol: number;
    columns: PlanColumn[];
    creates: PlannedCreate[];
    updates: PlannedUpdate[];
    writes: PlannedCellWrite[];
    appends: PlannedAppend[];
    deletes: PlannedDelete[];
    trash: number[];
    revive: number[];
    links: PlannedLink[];
    dropLinks: number[];
    errors: SheetSyncRowError[];
    conflicts: SheetSyncConflict[];
    notes: string[];
    read: number;
    unchanged: number;
    failed: number;
    sample: SheetSyncDryRun['sample'];
}

/** Errores y conflictos que se guardan para mostrar. */
export const PLAN_LIST_LIMIT = 50;

type Side = 'sheet' | 'app';

export function planSheetSync(input: PlanInput): SheetPlan {
    const { settings, ctx } = input;
    const reads = sheetSyncReadsSheet(settings.direction);
    const writes = sheetSyncWritesSheet(settings.direction);
    const idMode = settings.key.mode === 'app_id';
    const sampleSize = input.sampleSize ?? 0;

    const out: SheetPlan = {
        headerWrites: [],
        width: 0,
        keyCol: -1,
        columns: [],
        creates: [],
        updates: [],
        writes: [],
        appends: [],
        deletes: [],
        trash: [],
        revive: [],
        links: [],
        dropLinks: [],
        errors: [],
        conflicts: [],
        notes: [],
        read: 0,
        unchanged: 0,
        failed: 0,
        sample: [],
    };
    const errorRows = new Set<number>();
    const addError = (where: string, message: string, row?: number): void => {
        if (row !== undefined) {
            if (errorRows.has(row)) return;
            errorRows.add(row);
        }
        out.failed++;
        if (out.errors.length < PLAN_LIST_LIMIT) out.errors.push({ where, message });
    };
    const addNote = (n: string): void => {
        if (!out.notes.includes(n)) out.notes.push(n);
    };
    const addSample = (s: SheetSyncDryRun['sample'][number]): void => {
        if (out.sample.length < sampleSize) out.sample.push(s);
    };

    // ── Encabezados: dónde está cada columna; las que faltan se agregan ─────
    const headers = input.headers.map((h) => cellCanon(h));
    let lastUsed = -1;
    headers.forEach((h, i) => {
        if (h !== '') lastUsed = i;
    });
    let nextFree = lastUsed + 1;
    const place = (name: string): number => {
        const at = findSheetColumn(headers, name);
        if (at >= 0) return at;
        const col = nextFree++;
        out.headerWrites.push({ col, name });
        return col;
    };

    const keyName = settings.key.column;
    let keyCol = findSheetColumn(headers, keyName);
    if (keyCol < 0) {
        if (idMode || writes) keyCol = place(keyName);
        // La clave es lo único que une una fila con su registro.
    }
    out.keyCol = keyCol;

    const keyField = idMode ? null : input.keyField;
    const mapped: Array<{ name: string; field: Field }> = [...input.columns];
    // En modo campo, la columna clave también sincroniza el valor del campo.
    if (keyField && !mapped.some((m) => m.field.id === keyField.id)) mapped.unshift({ name: keyName, field: keyField });
    for (const m of mapped) {
        let index = findSheetColumn(headers, m.name);
        if (m.field.id === keyField?.id) index = keyCol;
        if (index < 0) {
            if (writes) index = place(m.name);
            else addNote(`La hoja no tiene la columna «${m.name}»: «${m.field.label}» no se trae.`);
        }
        if (index >= 0) out.columns.push({ name: m.name, index, field: m.field });
    }
    out.width = Math.max(nextFree, lastUsed + 1, 1);
    if (keyCol < 0) {
        addNote(`La hoja no tiene la columna clave «${keyName}»: no se puede saber qué fila es qué registro.`);
        return out;
    }

    // ── Claves ───────────────────────────────────────────────────────────────
    const keyOfCell = (cell: unknown) => sheetKeyOf(cell, keyField);
    const keyOfRecord = (r: RecordIn): string => {
        if (idMode) return String(r.id);
        const v = r.data[`f${keyField!.id}`];
        if (v === null || v === undefined) return '';
        return normalizeKey(keyField, cellCanon(fieldValueToCell(keyField!, v, ctx)));
    };

    const records = new Map(input.records.map((r) => [r.id, r]));
    const linkByKey = new Map<string, LinkIn>();
    const linkByRecord = new Map<number, LinkIn>();
    for (const l of input.links) {
        linkByKey.set(l.rowKey, l);
        linkByRecord.set(l.recordId, l);
    }
    const unlinkedByKey = new Map<string, RecordIn[]>();
    if (!idMode) {
        for (const r of input.records) {
            if (linkByRecord.has(r.id)) continue;
            const k = keyOfRecord(r);
            if (k === '') continue;
            unlinkedByKey.set(k, [...(unlinkedByKey.get(k) ?? []), r]);
        }
    }
    const paired = new Set<number>();
    const seenKeys = new Map<string, number>();
    const seenLinks = new Set<number>();
    const fpOf = (cells: unknown[]): string => rowFingerprint(cells.map((c, i) => (i === keyCol ? '' : cellCanon(c))));
    // Filas sin clave cuyo registro ya se creó en una corrida que no llegó a
    // escribir el ID (la hoja falló): se reconocen por su huella.
    const pendingByFp = new Map<string, LinkIn>();
    if (idMode) {
        for (const l of input.links) {
            if (l.snapshot.p === 1 && l.fingerprint && records.has(l.recordId)) pendingByFp.set(l.fingerprint, l);
        }
    }

    const label = (f: Field) => f.label;
    const show = (v: string): string => (v === '' ? '—' : v);

    /** Concilia las celdas de una fila con su registro. */
    const reconcile = (row: SheetRowIn, rec: RecordIn, link: LinkIn | null, rowKey: string, expectKey = rowKey): void => {
        const before: SheetRowSnapshot = { s: { ...(link?.snapshot.s ?? {}) }, a: { ...(link?.snapshot.a ?? {}) } };
        const after: SheetRowSnapshot = { s: { ...before.s }, a: { ...before.a } };
        const patch: Record<string, unknown> = {};
        const prev: Record<string, unknown> = {};
        const cellWrites: PlannedCellWrite[] = [];
        const changes: Array<{ label: string; before: string; after: string }> = [];
        const sheetChanges: Array<{ label: string; before: string; after: string }> = [];
        const where = `Fila ${row.row}`;
        let newKey = rowKey;
        for (const col of out.columns) {
            const f = col.field;
            const fk = String(f.id);
            const k = `f${f.id}`;
            const cell = row.cells[col.index];
            const sCanon = cellCanon(cell);
            const appVal = rec.data[k] ?? null;
            const aCanon = appCanon(f, appVal, ctx);
            const parsed = cellToFieldValue(cell, f, ctx);
            const equal = parsed.ok && sameBulkValue(parsed.value, appVal, f.type === 'multi_select');
            let action: Side | null = null;
            let conflict = false;
            if (equal) {
                action = null;
            } else if (settings.direction === 'sheet_to_app') {
                action = 'sheet';
            } else if (settings.direction === 'app_to_sheet') {
                action = 'app';
            } else {
                const snapS = link?.snapshot.s?.[fk];
                const snapA = link?.snapshot.a?.[fk];
                if (snapS === undefined || snapA === undefined) {
                    if (aCanon === '' && parsed.ok) action = 'sheet';
                    else if (sCanon === '') action = 'app';
                    else {
                        action = 'app';
                        conflict = true;
                    }
                } else {
                    const sChanged = sCanon !== snapS;
                    const aChanged = aCanon !== snapA;
                    if (sChanged && !aChanged) action = 'sheet';
                    else if (aChanged && !sChanged) action = 'app';
                    else if (sChanged && aChanged) {
                        action = 'app';
                        conflict = true;
                    } else action = null;
                }
            }
            if (action === 'sheet') {
                if (!parsed.ok) {
                    addError(where, `«${col.name}»: ${parsed.error} — «${f.label}» conserva su valor.`, row.row);
                    // Lo de la app queda; lo de la hoja también: no se marca como sincronizado.
                    continue;
                }
                patch[k] = parsed.value;
                prev[k] = appVal;
                after.s![fk] = sCanon;
                after.a![fk] = appCanon(f, parsed.value, ctx);
                before.s![fk] = sCanon;
                before.a![fk] = after.a![fk]!;
                changes.push({ label: label(f), before: show(aCanon), after: show(appCanon(f, parsed.value, ctx)) });
                if (f.id === keyField?.id) newKey = normalizeKey(keyField, appCanon(f, parsed.value, ctx));
            } else if (action === 'app') {
                const value = fieldValueToCell(f, appVal, ctx);
                cellWrites.push({ row: row.row, col: col.index, value, expectKey, recordId: rec.id });
                after.s![fk] = cellCanon(value);
                after.a![fk] = aCanon;
                sheetChanges.push({ label: label(f), before: show(sCanon), after: show(aCanon) });
                if (conflict && sCanon !== '' && out.conflicts.length < PLAN_LIST_LIMIT) {
                    out.conflicts.push({ where, field: f.label, kept: aCanon, replaced: sCanon });
                }
                if (f.id === keyField?.id) newKey = normalizeKey(keyField, aCanon);
            } else {
                after.s![fk] = sCanon;
                after.a![fk] = aCanon;
                before.s![fk] = sCanon;
                before.a![fk] = aCanon;
            }
        }
        if (Object.keys(patch).length > 0) {
            out.updates.push({ recordId: rec.id, where, before: { ...rec.data }, patch: { ...patch } });
            addSample({ where: `${where} → registro #${rec.id}`, action: 'update', changes });
        }
        if (cellWrites.length > 0) {
            out.writes.push(...cellWrites);
            addSample({ where: `Registro #${rec.id} → ${where.toLowerCase()}`, action: 'write_sheet', changes: sheetChanges });
        }
        if (Object.keys(patch).length === 0 && cellWrites.length === 0) out.unchanged++;
        out.links.push({
            recordId: rec.id,
            rowKey: newKey || rowKey,
            snapshotBefore: before,
            snapshotAfter: after,
            fingerprint: fpOf(row.cells),
            removed: false,
            dependsOnSheet: cellWrites.length > 0,
        });
    };

    /** Una fila nueva de la hoja → un registro nuevo. */
    const create = (row: SheetRowIn, key: string, note?: string, currentKey = ''): void => {
        const data: Record<string, unknown> = {};
        const snapshot: SheetRowSnapshot = { s: {}, a: {} };
        const changes: Array<{ label: string; before: string; after: string }> = [];
        for (const col of out.columns) {
            const f = col.field;
            const cell = row.cells[col.index];
            const sCanon = cellCanon(cell);
            const parsed = cellToFieldValue(cell, f, ctx);
            snapshot.s![String(f.id)] = sCanon;
            if (!parsed.ok) {
                addError(`Fila ${row.row}`, `«${col.name}»: ${parsed.error} — quedó vacío.`, row.row);
                snapshot.a![String(f.id)] = '';
                continue;
            }
            const empty = parsed.value === null || (Array.isArray(parsed.value) && parsed.value.length === 0);
            if (!empty) data[`f${f.id}`] = parsed.value;
            snapshot.a![String(f.id)] = appCanon(f, parsed.value, ctx);
            if (!empty) changes.push({ label: f.label, before: '—', after: show(snapshot.a![String(f.id)]!) });
        }
        if (note) addNote(note);
        out.creates.push({ row: row.row, key, data, snapshot, fingerprint: fpOf(row.cells), writeId: idMode, expectKey: currentKey });
        addSample({ where: `Fila ${row.row}`, action: 'create', changes });
    };

    // ── Filas de la hoja ─────────────────────────────────────────────────────
    for (const row of input.rows) {
        if (row.cells.every((c) => cellCanon(c) === '')) continue;
        out.read++;
        const { key, raw, bad } = keyOfCell(row.cells[keyCol]);
        if (bad) {
            addError(`Fila ${row.row}`, `«${raw}» no es un número de registro: borra lo que hay en «${keyName}» y la app le pone uno.`, row.row);
            continue;
        }
        if (key === '') {
            if (!idMode) {
                if (reads) addError(`Fila ${row.row}`, `La columna clave «${keyName}» está vacía: la fila no se trae.`, row.row);
                continue;
            }
            // Modo ID: una fila sin número es una fila nueva de la hoja.
            if (!reads) continue;
            const pending = pendingByFp.get(fpOf(row.cells));
            if (pending && !paired.has(pending.recordId)) {
                // Su registro ya existe (la corrida anterior no llegó a escribir el ID).
                const rec = records.get(pending.recordId)!;
                paired.add(rec.id);
                seenLinks.add(rec.id);
                pendingByFp.delete(pending.fingerprint ?? '');
                out.writes.push({ row: row.row, col: keyCol, value: rec.id, expectKey: '', recordId: rec.id });
                reconcile(row, rec, pending, String(rec.id), '');
                const l = out.links[out.links.length - 1]!;
                l.dependsOnSheet = true;
                l.snapshotBefore = { ...l.snapshotBefore, p: 1 };
                continue;
            }
            create(row, '');
            continue;
        }
        const first = seenKeys.get(key);
        if (first !== undefined) {
            addError(
                `Fila ${row.row}`,
                idMode
                    ? `El ID ${raw} también está en la fila ${first}: si copiaste la fila, borra el ID de la copia y la app le pone uno nuevo.`
                    : `La clave «${raw}» también está en la fila ${first}: se usó la primera.`,
                row.row,
            );
            continue;
        }
        seenKeys.set(key, row.row);

        const link = linkByKey.get(key);
        if (link) {
            seenLinks.add(link.recordId);
            if (link.trashed) {
                if (link.removed) {
                    // Se había borrado de la hoja (y su registro fue a la papelera): volvió.
                    if (reads && settings.on_sheet_delete === 'trash') {
                        out.revive.push(link.recordId);
                        out.links.push({ ...linkCopy(link), removed: false });
                        addSample({ where: `Fila ${row.row}`, action: 'update', changes: [{ label: 'Registro', before: 'En la papelera', after: 'De vuelta' }] });
                    } else out.unchanged++;
                    continue;
                }
                // Se borró en la app y la fila sigue.
                if (writes && settings.on_app_delete === 'delete_row') {
                    out.deletes.push({ row: row.row, key, recordId: link.recordId });
                    addSample({ where: `Fila ${row.row}`, action: 'delete_row', changes: [] });
                } else out.unchanged++;
                continue;
            }
            const rec = records.get(link.recordId);
            if (!rec) {
                out.unchanged++;
                continue;
            }
            paired.add(rec.id);
            reconcile(row, rec, link, key);
            continue;
        }

        // Sin vínculo: ¿es un registro que ya está en la lista?
        let adopt: RecordIn | null = null;
        if (idMode) {
            const rec = records.get(Number(key));
            if (rec && !linkByRecord.has(rec.id) && !paired.has(rec.id)) adopt = rec;
        } else {
            const cands = (unlinkedByKey.get(key) ?? []).filter((r) => !paired.has(r.id));
            if (cands.length > 1) {
                addError(`Fila ${row.row}`, `Hay ${cands.length} registros con la clave «${raw}» en la lista: no se sabe cuál es.`, row.row);
                continue;
            }
            adopt = cands[0] ?? null;
        }
        if (adopt) {
            paired.add(adopt.id);
            seenLinks.add(adopt.id);
            reconcile(row, adopt, null, key);
            continue;
        }
        if (!reads) {
            // «De la app a la hoja»: una fila que no es de la lista no se toca.
            out.unchanged++;
            continue;
        }
        if (idMode) {
            // Un ID que no es de esta lista: se crea el registro y se le pone el suyo.
            create(row, '', 'Algunas filas tenían un ID que no es de un registro de esta lista: se crearon como registros nuevos con su propio ID.', key);
            continue;
        }
        create(row, key);
    }

    // ── Vínculos cuya fila ya no está en la hoja ─────────────────────────────
    for (const l of input.links) {
        if (seenLinks.has(l.recordId)) continue;
        if (input.sheetTruncated) {
            out.links.push(linkCopy(l));
            continue;
        }
        if (l.trashed) {
            if (!l.removed) out.dropLinks.push(l.recordId); // Borrado de los dos lados.
            continue;
        }
        const rec = records.get(l.recordId);
        if (!rec) continue;
        if (!reads) {
            // «De la app a la hoja»: la app manda, la fila vuelve.
            if (!paired.has(rec.id)) appendRecord(rec);
            continue;
        }
        if (l.removed) continue;
        if (l.snapshot.p === 1) {
            // Era una fila nueva cuyo ID no se llegó a escribir y ya no se reconoce.
            out.links.push({ ...linkCopy(l), removed: true });
            continue;
        }
        if (settings.on_sheet_delete === 'trash') {
            out.trash.push(rec.id);
            addSample({ where: `Registro #${rec.id}`, action: 'trash', changes: [] });
        } else {
            addNote('Algunas filas que estaban en la hoja ya no están: sus registros quedan en la app.');
        }
        out.links.push({ ...linkCopy(l), removed: true });
    }

    // ── Registros de la app que no están en la hoja ──────────────────────────
    function appendRecord(rec: RecordIn): void {
        const key = keyOfRecord(rec);
        if (key === '') {
            addError(`Registro #${rec.id}`, `No tiene «${keyField?.label ?? keyName}»: sin clave no se puede agregar a la hoja.`);
            return;
        }
        if (seenKeys.has(key) || out.appends.some((a) => a.key === key)) {
            addError(`Registro #${rec.id}`, `Otra fila u otro registro ya tiene la clave «${key}»: no se agrega a la hoja.`);
            return;
        }
        const cells: SheetCell[] = Array.from({ length: out.width }, () => '');
        cells[keyCol] = idMode ? rec.id : fieldValueToCell(keyField!, rec.data[`f${keyField!.id}`] ?? null, ctx);
        const snapshot: SheetRowSnapshot = { s: {}, a: {} };
        const changes: Array<{ label: string; before: string; after: string }> = [];
        for (const col of out.columns) {
            const v = rec.data[`f${col.field.id}`] ?? null;
            const cell = fieldValueToCell(col.field, v, ctx);
            cells[col.index] = cell;
            snapshot.s![String(col.field.id)] = cellCanon(cell);
            snapshot.a![String(col.field.id)] = appCanon(col.field, v, ctx);
            if (cellCanon(cell) !== '') changes.push({ label: col.field.label, before: '—', after: cellCanon(cell) });
        }
        out.appends.push({ recordId: rec.id, key, cells, snapshot, fingerprint: fpOf(cells) });
        addSample({ where: `Registro #${rec.id}`, action: 'add_row', changes });
    }
    if (writes) {
        for (const rec of input.records) {
            if (paired.has(rec.id) || linkByRecord.has(rec.id)) continue;
            appendRecord(rec);
        }
        if (input.recordsTruncated) addNote('La lista tiene más registros de los que maneja una sincronización: los más nuevos no se agregaron a la hoja.');
    }
    if (input.sheetTruncated) addNote('La hoja tiene más filas de las que maneja una sincronización: lo de más abajo no se leyó ni se tocó.');
    return out;
}

/**
 * La clave de una celda de la columna clave, normalizada. Sin campo (modo «ID
 * de la app») tiene que ser un número de registro: `bad` si no lo es.
 */
export function sheetKeyOf(cell: unknown, keyField: Pick<Field, 'id' | 'type'> | null): { key: string; raw: string; bad: boolean } {
    const raw = cellCanon(cell);
    if (raw === '') return { key: '', raw, bad: false };
    if (!keyField) {
        const m = /^(\d{1,15})(?:\.0+)?$/.exec(raw);
        return m ? { key: normalizeKey(null, m[1]!), raw, bad: false } : { key: '', raw, bad: true };
    }
    return { key: normalizeKey(keyField, raw), raw, bad: false };
}

function linkCopy(l: LinkIn): PlannedLink {
    return {
        recordId: l.recordId,
        rowKey: l.rowKey,
        snapshotBefore: l.snapshot,
        snapshotAfter: l.snapshot,
        fingerprint: l.fingerprint,
        removed: l.removed,
        dependsOnSheet: false,
    };
}
