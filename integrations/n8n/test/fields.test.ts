import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { apiBase, buildData, fieldToColumn, parseLooseNumber, simplifyRecord, toApiValue, type ApiField } from '../nodes/ImaginaBase/fields';
import { verifySignature } from '../nodes/ImaginaBase/transport';

const fields: ApiField[] = [
    { id: 1, slug: 'nombre', label: 'Nombre', type: 'text', is_required: true },
    { id: 2, slug: 'monto', label: 'Monto', type: 'currency' },
    { id: 3, slug: 'estado', label: 'Estado', type: 'select', config: { options: [{ value: 'pendiente_pago', label: 'Pendiente de pago' }, { value: 'pagada', label: 'Pagada' }] } },
    { id: 4, slug: 'etiquetas', label: 'Etiquetas', type: 'multi_select', config: { options: [{ value: 'vip', label: 'VIP' }, { value: 'promo', label: 'Promoción' }] } },
    { id: 5, slug: 'vence', label: 'Vence', type: 'date' },
    { id: 6, slug: 'cita', label: 'Cita', type: 'datetime' },
    { id: 7, slug: 'activo', label: 'Activo', type: 'checkbox' },
    { id: 8, slug: 'cliente', label: 'Cliente', type: 'relation' },
    { id: 9, slug: 'total', label: 'Total', type: 'formula' },
    { id: 10, slug: 'codigo', label: 'Código', type: 'autonumber' },
];

test('la dirección de la API, con o sin /api/v1 y barras de más', () => {
    assert.equal(apiBase('https://app.x.com'), 'https://app.x.com/api/v1');
    assert.equal(apiBase('https://app.x.com/'), 'https://app.x.com/api/v1');
    assert.equal(apiBase(' https://app.x.com/api/v1/ '), 'https://app.x.com/api/v1');
});

test('columnas: sólo lo que se escribe a mano, con su tipo y las opciones', () => {
    const cols = fields.map(fieldToColumn).filter(Boolean);
    assert.deepEqual(cols.map((c) => c!.id), ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8']);
    const estado = cols.find((c) => c!.id === 'f3')!;
    assert.equal(estado.type, 'options');
    assert.deepEqual(estado.options, [{ name: 'Pendiente de pago', value: 'pendiente_pago' }, { name: 'Pagada', value: 'pagada' }]);
    assert.equal(cols.find((c) => c!.id === 'f1')!.required, true);
    assert.equal(cols.find((c) => c!.id === 'f2')!.type, 'number');
});

test('valores: números latinos, opciones por etiqueta, fechas y vínculos', () => {
    const f = (slug: string) => fields.find((x) => x.slug === slug)!;
    assert.equal(toApiValue(f('monto'), '1500,5'), 1500.5);
    assert.equal(toApiValue(f('estado'), 'pendiente de pago'), 'pendiente_pago');
    assert.deepEqual(toApiValue(f('etiquetas'), 'VIP, promocion'), ['vip', 'promo']);
    assert.deepEqual(toApiValue(f('etiquetas'), '["vip"]'), ['vip']);
    assert.equal(toApiValue(f('vence'), '2026-11-30T10:00:00.000-05:00'), '2026-11-30');
    assert.equal(toApiValue(f('cita'), '2026-11-30T10:00:00-05:00'), '2026-11-30T15:00:00.000Z');
    assert.equal(toApiValue(f('cita'), { toISO: () => '2026-11-30T10:00:00-05:00' }), '2026-11-30T15:00:00.000Z');
    assert.equal(toApiValue(f('activo'), 'sí'), true);
    assert.equal(toApiValue(f('activo'), false), false);
    assert.deepEqual(toApiValue(f('cliente'), '12, 13'), [12, 13]);
    assert.equal(toApiValue(f('nombre'), ''), null);
});

test('data: en un alta lo vacío no viaja; en un cambio lo vacío vacía; los calculados nunca', () => {
    const vals = { f1: 'Ana', f2: '', f9: 99, nombre_x: 1, estado: 'Pagada', f10: 'X-1' };
    assert.deepEqual(buildData(fields, vals, 'create'), { f1: 'Ana', f3: 'pagada' });
    assert.deepEqual(buildData(fields, vals, 'update'), { f1: 'Ana', f2: null, f3: 'pagada' });
});

test('registro aplanado por nombre interno, con los vínculos', () => {
    const out = simplifyRecord(
        { id: 7, data: { f1: 'Ana', f99: 'x' }, relations: { f8: [3] }, created_at: 'c', updated_at: 'u' },
        fields,
    );
    assert.deepEqual(out, { id: 7, nombre: 'Ana', f99: 'x', cliente: [3], created_at: 'c', updated_at: 'u' });
});

test('firma: válida, alterada, vieja y sin secreto', () => {
    const secret = 'whsec_abc';
    const body = '{"id":"evt_1","event":"record.created"}';
    const t = 1_700_000_000;
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const header = `t=${t},v1=${v1}`;
    assert.equal(verifySignature(secret, header, body, t + 10), true);
    assert.equal(verifySignature(secret, header, body + ' ', t + 10), false);
    assert.equal(verifySignature('otro', header, body, t + 10), false);
    assert.equal(verifySignature(secret, header, body, t + 301), false);
    assert.equal(verifySignature('', header, body, t), false);
    assert.equal(verifySignature(secret, undefined, body, t), false);
    assert.equal(verifySignature(secret, 't=1,v1=zz', body, 1), false);
});

test('números escritos a mano, con miles y decimales de cualquier país', () => {
    assert.equal(parseLooseNumber('1250.5'), 1250.5);
    assert.equal(parseLooseNumber('1.250,5'), 1250.5);
    assert.equal(parseLooseNumber('1,250.5'), 1250.5);
    assert.equal(parseLooseNumber('1.250.000'), 1250000);
    assert.equal(parseLooseNumber('1.250'), 1250);
    assert.equal(parseLooseNumber('$ 1.250.000,75'), 1250000.75);
    assert.equal(parseLooseNumber('COP 15000'), 15000);
    assert.equal(parseLooseNumber('0,5'), 0.5);
    assert.equal(parseLooseNumber('-3,25'), -3.25);
    assert.equal(parseLooseNumber('abc'), null);
});
