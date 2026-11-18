import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import {
    commentEventValue,
    commentTriggerMatches,
    describeCommentTrigger,
    isFindableFieldType,
    readCommentTriggerConfig,
    readFindRecordsConfig,
    readUpsertRecordConfig,
    type CommentEventInfo,
} from './automation-records';

const ev = (over: Partial<CommentEventInfo> = {}): CommentEventInfo => ({
    id: 7,
    text: 'Necesito la FACTURA de octubre, por favor',
    author_id: 3,
    author_name: 'Ana',
    from: 'client',
    source: 'portal',
    visibility: 'client',
    parent_id: null,
    ...over,
});

describe('v0.1.444 — buscar registros, crear o actualizar y comentarios', () => {
    it('lee «Buscar registros» con tolerancia y valores por defecto', () => {
        const c = readFindRecordsConfig({ conditions: [{ field: 'correo', op: 'eq', value: '{{correo}}' }, { op: 'eq' }, { slug: 'estado', op: 'raro' }], limit: 500 });
        expect(c.conditions).toEqual([
            { field: 'correo', op: 'eq', value: '{{correo}}' },
            { field: 'estado', op: 'eq', value: '' },
        ]);
        expect(c.limit).toBe(50);
        expect(c.responseName).toBe('busqueda');
        expect(c.listId).toBeNull();
        expect(c.excludeSelf).toBe(true);
        expect(c.ifNone).toBe('continue');
        expect(readFindRecordsConfig({ list_id: 4, if_none: 'stop', sort_field: 'monto', sort_dir: 'asc', response_name: 'Cliente' })).toMatchObject({
            listId: 4,
            ifNone: 'stop',
            sortField: 'monto',
            sortDir: 'asc',
            responseName: 'cliente',
        });
    });

    it('lee «Crear o actualizar»: por un campo sólo si se eligió uno', () => {
        expect(readUpsertRecordConfig({ match_by: 'field', match_field: 'nit', match_value: '{{nit}}', values: { nombre: '{{nombre}}' } })).toMatchObject({
            mode: 'upsert',
            match: { by: 'field', field: 'nit' },
            matchValue: '{{nit}}',
            responseName: 'registro',
        });
        expect(readUpsertRecordConfig({ match_by: 'field', match_field: '' }).match).toEqual({ by: 'record_id' });
        expect(readUpsertRecordConfig({ mode: 'create_only', match_value: 12 })).toMatchObject({ mode: 'create_only', matchValue: '12' });
    });

    it('avisa lo que falta y que dos pasos no guarden el mismo nombre', () => {
        const issues = automationConfigIssues({
            trigger_type: 'record_created',
            actions: [
                { type: 'find_records', config: {} },
                { type: 'find_records', config: { limit: 80 } },
                { type: 'upsert_record', config: { match_by: 'field', values: {} } },
                { type: 'upsert_record', config: { mode: 'create_only', match_value: '{{nit}}', response_name: 'Mal nombre' } },
            ],
        });
        const paths = issues.map((i) => i.path);
        expect(paths).toContain('actions.1.config.response_name'); // «busqueda» repetido
        expect(paths).toContain('actions.1.config.limit');
        expect(paths).toContain('actions.2.config.match_field');
        expect(paths).toContain('actions.2.config.match_value');
        expect(paths).toContain('actions.2.config.values');
        expect(paths).toContain('actions.3.config.response_name');
        expect(paths).not.toContain('actions.3.config.values'); // «sólo crear» no exige valores
        expect(
            automationConfigIssues({
                trigger_type: 'comment_added',
                actions: [
                    { type: 'find_records', config: { response_name: 'cliente' } },
                    { type: 'upsert_record', config: { match_value: '{{record.id}}', values: { estado: 'abierto' } } },
                ],
            }),
        ).toEqual([]);
    });

    it('el disparador de comentarios filtra por autor, visibilidad, respuestas y palabras (sin tildes)', () => {
        const any = readCommentTriggerConfig({});
        expect(commentTriggerMatches(any, ev())).toEqual({ ok: true });
        expect(commentTriggerMatches(readCommentTriggerConfig({ comment_from: 'team' }), ev()).ok).toBe(false);
        expect(commentTriggerMatches(readCommentTriggerConfig({ comment_visibility: 'internal' }), ev()).ok).toBe(false);
        expect(commentTriggerMatches(readCommentTriggerConfig({ comment_replies: 'replies' }), ev()).ok).toBe(false);
        expect(commentTriggerMatches(readCommentTriggerConfig({ comment_replies: 'top' }), ev({ parent_id: 3 })).ok).toBe(false);
        expect(commentTriggerMatches(readCommentTriggerConfig({ comment_contains: 'cotización, factura' }), ev()).ok).toBe(true);
        const miss = commentTriggerMatches(readCommentTriggerConfig({ comment_contains: 'urgente' }), ev());
        expect(miss.ok).toBe(false);
        expect(readCommentTriggerConfig({ comment_from: 'raro' }).from).toBe('any');
    });

    it('se busca por campos con valor propio y por relaciones; nunca por calculados ni archivos', () => {
        for (const t of ['text', 'email', 'phone', 'number', 'select', 'date', 'relation', 'autonumber', 'ai']) expect(isFindableFieldType(t)).toBe(true);
        for (const t of ['file', 'computed', 'lookup', 'rollup', 'formula', 'button', 'created_at', 'approval']) expect(isFindableFieldType(t)).toBe(false);
    });

    it('variables y resumen del comentario', () => {
        const e = ev({ parent_id: 2, source: 'email' });
        expect(commentEventValue(e, 'de')).toBe('cliente');
        expect(commentEventValue(e, 'origen')).toBe('correo');
        expect(commentEventValue(e, 'es_respuesta')).toBe('Sí');
        expect(commentEventValue(e, 'visibilidad')).toBe('visible para el cliente');
        expect(commentEventValue(e, 'otra')).toBeUndefined();
        expect(describeCommentTrigger(readCommentTriggerConfig({ comment_from: 'client', comment_contains: 'factura' }))).toBe(
            'Cuando el cliente agrega un comentario con «factura»',
        );
    });
});
