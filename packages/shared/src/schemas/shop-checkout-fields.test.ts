import { describe, expect, it } from 'vitest';
import { publicShopCheckoutFields, readShopConfig } from './shop';
import {
    cleanShopAnswer,
    cleanShopAnswers,
    isShopDate,
    parseShopNumberInput,
    shopAnswerText,
    shopFieldLabel,
    shopPhoneOk,
    type PublicShopQuestion,
} from './shop-checkout-fields';
import { shopWhatsappMessage } from './shop-logic';

const q = (p: Partial<PublicShopQuestion>): PublicShopQuestion => ({
    id: 'q1',
    label: 'Barrio',
    type: 'text',
    required: false,
    help: '',
    placeholder: '',
    options: [],
    place: 'end',
    ...p,
});

describe('v0.1.430 — datos y preguntas del pago', () => {
    it('lo guardado antes se lee igual: notas como sí/no y el celular opcional', () => {
        expect(readShopConfig({ checkout: { ask_notes: true } }).checkout).toMatchObject({ ask_notes: 'optional', ask_phone: 'optional', ask_document: 'optional', questions: [] });
        expect(readShopConfig({ checkout: { ask_notes: false } }).checkout.ask_notes).toBe('hidden');
        expect(readShopConfig({ checkout: { ask_notes: 'raro', ask_phone: 'required' } }).checkout).toMatchObject({ ask_notes: 'optional', ask_phone: 'required' });
    });

    it('una pregunta rota se descarta sin tirar las demás; las opciones quedan limpias', () => {
        const c = readShopConfig({
            checkout: {
                questions: [
                    { id: 'a', label: 'Canal', type: 'select', options: ['Instagram', ' instagram', '', 'Recomendación'] },
                    { id: 'NO VALE', label: 'x' },
                    { id: 'a', label: 'repetida' },
                    { id: 'b', label: 'Fecha', type: 'date', mode: 'required', place: 'you' },
                ],
            },
        }).checkout.questions;
        expect(c.map((x) => x.id)).toEqual(['a', 'b']);
        expect(c[0]!.options).toEqual(['Instagram', 'Recomendación']);
        expect(c[1]).toMatchObject({ type: 'date', mode: 'required', place: 'you', field_id: null });
    });

    it('a la página llegan sólo las preguntas completas y sin la columna', () => {
        const c = readShopConfig({
            checkout: {
                labels: { document: 'RUT' },
                questions: [
                    { id: 'a', label: '', type: 'text' },
                    { id: 'b', label: 'Canal', type: 'select', options: [] },
                    { id: 'c', label: 'Barrio', type: 'text', mode: 'required', field_id: 12 },
                ],
            },
        }).checkout;
        const pub = publicShopCheckoutFields(c);
        expect(pub.questions).toEqual([{ id: 'c', label: 'Barrio', type: 'text', required: true, help: '', placeholder: '', options: [], place: 'end' }]);
        expect(shopFieldLabel(pub, 'document')).toBe('RUT');
        expect(shopFieldLabel(pub, 'phone')).toBe('Celular');
    });

    it('cada tipo de respuesta se limpia y se revisa', () => {
        expect(cleanShopAnswer(q({ required: true }), '  ')).toEqual({ error: 'Completa «Barrio».' });
        expect(cleanShopAnswer(q({}), '  ')).toEqual({ value: undefined });
        expect(cleanShopAnswer(q({ type: 'select', options: ['Recomendación'] }), 'recomendacion')).toEqual({ value: 'Recomendación' });
        expect(cleanShopAnswer(q({ type: 'select', options: ['Recomendación'] }), 'TikTok')).toMatchObject({ error: expect.stringContaining('opciones') });
        expect(cleanShopAnswer(q({ type: 'checkbox', required: true, label: 'Acepto' }), false)).toEqual({ error: 'Marca «Acepto».' });
        expect(cleanShopAnswer(q({ type: 'checkbox' }), false)).toEqual({ value: false });
        expect(cleanShopAnswer(q({ type: 'number' }), '1.500,5', 'dot_comma')).toEqual({ value: 1500.5 });
        expect(cleanShopAnswer(q({ type: 'number' }), 'muchos')).toMatchObject({ error: expect.stringContaining('número') });
        expect(cleanShopAnswer(q({ type: 'date' }), '2028-02-29')).toEqual({ value: '2028-02-29' });
        expect(cleanShopAnswer(q({ type: 'date' }), '2026-02-29')).toMatchObject({ error: expect.stringContaining('fecha') });
        expect(cleanShopAnswer(q({}), 'x'.repeat(501))).toMatchObject({ error: expect.stringContaining('500') });
        expect(cleanShopAnswer(q({ type: 'textarea' }), 'x'.repeat(1500))).toEqual({ value: 'x'.repeat(1500) });
    });

    it('las de la dirección sólo se piden si la entrega pide dirección; lo que no se pregunta se descarta', () => {
        const qs = [q({ id: 'barrio', place: 'delivery', required: true }), q({ id: 'canal', label: 'Canal', required: true })];
        expect(cleanShopAnswers(qs, { canal: 'Web' }, { withAddress: true }).error).toEqual({ id: 'barrio', text: 'Completa «Barrio».' });
        expect(cleanShopAnswers(qs, { canal: 'Web', barrio: 'Centro', otra: 'x' }, { withAddress: false })).toEqual({ answers: { canal: 'Web' }, error: null });
    });

    it('números, fechas y sí/no en palabras; el celular con al menos 7 números', () => {
        expect(parseShopNumberInput('1,500', 'comma_dot')).toBe(1500);
        expect(parseShopNumberInput('1.500', 'dot_comma')).toBe(1500);
        expect(parseShopNumberInput('-3,25', 'dot_comma')).toBe(-3.25);
        expect(parseShopNumberInput('12abc')).toBeNull();
        expect(isShopDate('2026-13-01')).toBe(false);
        expect(shopAnswerText(q({ type: 'number' }), 1234567.5, 'dot_comma')).toBe('1.234.567,5');
        expect(shopAnswerText(q({ type: 'date' }), '2026-12-05')).toBe('05/12/2026');
        expect(shopAnswerText(q({ type: 'checkbox' }), true)).toBe('Sí');
        expect(shopPhoneOk('300 111')).toBe(false);
        expect(shopPhoneOk('+57 300 111 2233')).toBe(true);
    });

    it('el mensaje de WhatsApp lleva las respuestas', () => {
        const text = shopWhatsappMessage(
            {
                number: 'PED-0001',
                lines: [{ title: 'Camiseta', qty: 1, subtotal: 40000 }],
                shipping: 0,
                total: 40000,
                delivery: 'Recoger en el local',
                customer: { name: 'Ana', address: '', city: '', notes: '', answers: [{ label: 'Talla', text: 'M' }] },
                url: null,
            },
            '',
            (n) => `$ ${n}`,
        );
        expect(text).toContain('Talla: M');
    });
});
