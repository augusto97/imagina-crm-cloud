// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SmsCounter } from './smsUi';

describe('contador de SMS (ADR-S82)', () => {
    afterEach(cleanup);

    it('cuenta el texto FINAL: con tildes es Unicode y «Quitar tildes» lo vuelve GSM', () => {
        const text = 'Hola Ana, tu cita quedó confirmada para mañana a las 9. Te esperamos con gusto, gracias.';
        const onStrip = vi.fn();
        const { getByTestId, rerender } = render(<SmsCounter text={text} stripAccents={false} onStripAccents={onStrip} />);
        expect(getByTestId('imcrm-sms-counter').getAttribute('data-encoding')).toBe('ucs2');
        expect(getByTestId('imcrm-sms-counter').getAttribute('data-segments')).toBe('2');
        expect(getByTestId('imcrm-sms-counter-ucs2').textContent).toContain('«ó»');
        fireEvent.click(getByTestId('imcrm-sms-strip-accents'));
        expect(onStrip).toHaveBeenCalledWith(true);
        rerender(<SmsCounter text={text} stripAccents onStripAccents={onStrip} />);
        expect(getByTestId('imcrm-sms-counter').getAttribute('data-encoding')).toBe('gsm7');
        expect(getByTestId('imcrm-sms-counter').getAttribute('data-segments')).toBe('1');
    });

    it('con variables la opción se ve aunque el texto no tenga tildes (los datos sí pueden traerlas)', () => {
        const { queryByTestId, rerender } = render(<SmsCounter text="Hola {{nombre}}, tu factura vence pronto." stripAccents onStripAccents={() => {}} hasVariables />);
        expect(queryByTestId('imcrm-sms-strip-accents')).not.toBeNull();
        // Sin variables y sin tildes no hay nada que quitar.
        rerender(<SmsCounter text="Hola, tu factura vence pronto." stripAccents={false} onStripAccents={() => {}} />);
        expect(queryByTestId('imcrm-sms-strip-accents')).toBeNull();
    });
});
