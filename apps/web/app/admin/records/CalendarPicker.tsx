import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import 'react-day-picker/style.css';

/**
 * v0.1.256 — El calendario (react-day-picker + date-fns, ~300 KB sin
 * minificar) en su propio chunk: cada celda de fecha monta un
 * `DateCellEditor`, pero el calendario sólo se dibuja al abrir el popover.
 * Español y semana desde el lunes, como la vista Calendario (v0.1.192).
 */
export default function CalendarPicker(props: DayPickerProps): JSX.Element {
    return <DayPicker locale={es} weekStartsOn={1} {...props} />;
}
