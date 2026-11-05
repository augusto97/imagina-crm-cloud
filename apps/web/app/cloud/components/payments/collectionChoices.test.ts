import { describe, expect, it } from 'vitest';

import { proposeCollectionChoices } from './collectionChoices';

describe('qué columnas de cobro se proponen (v0.1.365)', () => {
    const fields = [
        { id: 1, label: 'Cliente', type: 'text' },
        { id: 2, label: 'Link de pago', type: 'url' },
        { id: 3, label: 'Pagos recientes', type: 'date' },
    ];

    it('sin elegir: el «Link de pago» de la lista y columnas nuevas para estado y fecha', () => {
        expect(proposeCollectionChoices(fields, null)).toEqual({ link: 2, status: 'create', paid_at: 'create', paid_amount: null, method: null });
    });

    it('ya elegido: muestra lo guardado (también «No guardar») y olvida columnas borradas', () => {
        const current = { link: 2, status: null, paid_at: 3, paid_amount: 99, method: null };
        expect(proposeCollectionChoices(fields, current)).toEqual({ link: 2, status: null, paid_at: 3, paid_amount: null, method: null });
    });
});
