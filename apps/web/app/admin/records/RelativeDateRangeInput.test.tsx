// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTenantFormat } from '@/lib/tenantFormat';

import { RelativeDateRangeInput } from './RelativeDateRangeInput';

/** v0.1.469 — el selector de «es en…» arma y lee el valor guardado. */

const clock = { now: new Date('2026-11-26T15:00:00Z'), timeZone: 'America/Bogota' };

describe('RelativeDateRangeInput', () => {
    beforeEach(() => setTenantFormat({ date_format: 'dmy' }));
    afterEach(() => {
        cleanup();
        setTenantFormat(null);
    });

    it('elegir «Próximos N días…» guarda {days, dir} y muestra el rango real', () => {
        const onChange = vi.fn();
        const { getByTestId, rerender } = render(<RelativeDateRangeInput value="this_month" onChange={onChange} clock={clock} />);
        expect(getByTestId('imcrm-relative-date-preview').textContent).toBe('Del 01/11/2026 al 30/11/2026');
        fireEvent.change(getByTestId('imcrm-relative-date-select'), { target: { value: 'rolling:next' } });
        expect(onChange).toHaveBeenLastCalledWith({ days: 10, dir: 'next' });
        rerender(<RelativeDateRangeInput value={{ days: 10, dir: 'next' }} onChange={onChange} clock={clock} />);
        expect((getByTestId('imcrm-relative-date-days') as HTMLInputElement).value).toBe('10');
        expect(getByTestId('imcrm-relative-date-preview').textContent).toBe('Del 26/11/2026 al 05/12/2026');
    });

    it('cambiar el número guarda sólo valores que sirven', () => {
        const onChange = vi.fn();
        const { getByTestId, queryByRole } = render(<RelativeDateRangeInput value={{ days: 30, dir: 'before' }} onChange={onChange} clock={clock} />);
        expect(getByTestId('imcrm-relative-date-preview').textContent).toBe('Antes del 27/10/2026');
        const days = getByTestId('imcrm-relative-date-days');
        fireEvent.change(days, { target: { value: '45' } });
        expect(onChange).toHaveBeenLastCalledWith({ days: 45, dir: 'before' });
        onChange.mockClear();
        fireEvent.change(days, { target: { value: '0' } });
        expect(onChange).not.toHaveBeenCalled();
        expect(queryByRole('alert')?.textContent).toMatch(/1 a 3650/);
    });

    it('lee un valor guardado de cada forma', () => {
        const { getByTestId, rerender, queryByTestId } = render(
            <RelativeDateRangeInput value={{ days: 15, dir: 'after' }} onChange={() => {}} clock={clock} />,
        );
        expect((getByTestId('imcrm-relative-date-select') as HTMLSelectElement).value).toBe('rolling:after');
        expect(getByTestId('imcrm-relative-date-preview').textContent).toBe('Desde el 12/12/2026');
        rerender(<RelativeDateRangeInput value={{ from: '2026-12-01', to: '2026-12-15' }} onChange={() => {}} clock={clock} />);
        expect((getByTestId('imcrm-relative-date-select') as HTMLSelectElement).value).toBe('custom');
        expect((getByTestId('imcrm-relative-date-from') as HTMLInputElement).value).toBe('2026-12-01');
        expect(queryByTestId('imcrm-relative-date-days')).toBeNull();
        rerender(<RelativeDateRangeInput value="next_30_days" onChange={() => {}} clock={clock} />);
        expect((getByTestId('imcrm-relative-date-select') as HTMLSelectElement).value).toBe('next_30_days');
    });

    it('«Personalizado…» arranca con el rango que se estaba viendo', () => {
        const onChange = vi.fn();
        const { getByTestId } = render(<RelativeDateRangeInput value={{ days: 3, dir: 'next' }} onChange={onChange} clock={clock} />);
        fireEvent.change(getByTestId('imcrm-relative-date-select'), { target: { value: 'custom' } });
        expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-26', to: '2026-11-28' });
    });
});
