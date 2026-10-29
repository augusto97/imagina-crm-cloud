import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * El horario de la Ley 2300: lunes a viernes de 7:00 a 19:00, sábados de 8:00
 * a 15:00, domingos y festivos nada. Un recordatorio de cobro creado el
 * domingo queda programado y sale el primer momento permitido.
 */

const CSS = `
@keyframes sh-msg{0%,8%{opacity:0;transform:translate(0,0) scale(.96)}14%,34%{opacity:1;transform:translate(0,0) scale(1)}52%,90%{opacity:1;transform:translate(-312px,-45px) scale(1)}96%,100%{opacity:0}}
@keyframes sh-tag{0%,50%{opacity:0}56%,90%{opacity:1}96%,100%{opacity:0}}
@keyframes sh-block{0%,14%{opacity:0}20%,40%{opacity:1}46%,100%{opacity:0}}
`;

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Fracciones del día (0 = 0:00, 1 = 24:00) con envío permitido.
const WINDOWS: Array<[number, number] | null> = [
    [7 / 24, 19 / 24],
    [7 / 24, 19 / 24],
    [7 / 24, 19 / 24],
    [7 / 24, 19 / 24],
    [7 / 24, 19 / 24],
    [8 / 24, 15 / 24],
    null,
];

export default function SmsHours(): JSX.Element {
    const colW = 54;
    const top = 70;
    const h = 170;
    return (
        <Stage label="El horario de la Ley 2300: de lunes a viernes de 7 de la mañana a 7 de la noche, los sábados de 8 a 3, y nunca los domingos ni festivos. Un SMS creado el domingo sale el lunes a las 7." tint="violet">
            <Keyframes css={CSS} />
            <At x={30} y={22}>
                <T size={11} weight={700}>
                    Horario para mensajes comerciales y de cobranza
                </T>
            </At>
            {DAYS.map((d, i) => {
                const w = WINDOWS[i];
                return (
                    <At key={d} x={30 + i * colW} y={top - 18} w={colW - 6}>
                        <T size={9} weight={600} color={C.mutedFg} style={{ display: 'block', textAlign: 'center' }}>
                            {d}
                        </T>
                        <div style={{ position: 'relative', marginTop: 6, height: h, borderRadius: 7, background: C.muted, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                            {w ? (
                                <span
                                    style={{
                                        position: 'absolute',
                                        left: 3,
                                        right: 3,
                                        top: w[0] * h,
                                        height: (w[1] - w[0]) * h,
                                        borderRadius: 5,
                                        background: tone('mint', 0.35),
                                        border: `1px solid ${tone('mint', 0.6)}`,
                                    }}
                                />
                            ) : (
                                <span style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(135deg, transparent 0 6px, ${tone('rose', 0.18)} 6px 9px)` }} />
                            )}
                        </div>
                    </At>
                );
            })}
            <At x={30 + 6 * colW + 2} y={top + 92} a="sh-block" style={{ opacity: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: tone('rose') }}>✕</span>
            </At>
            <At x={30 + 6 * colW - 10} y={top + 92} a="sh-msg" style={{ opacity: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 7px', borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 6px 14px -8px rgba(15,23,42,.4)' }}>
                    <T size={8.5} weight={700}>
                        SMS de cobro
                    </T>
                </span>
            </At>
            <At x={34} y={top + 72} a="sh-tag" style={{ opacity: 0 }}>
                <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 99, background: tone('violet', 0.18), color: tone('violet'), fontSize: 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    Programado · lunes 7:00 a. m.
                </span>
            </At>
            <At x={30} y={top + h + 4}>
                <T size={8.5} color={C.mutedFg}>
                    En la zona horaria de la empresa. Tampoco sale en festivos.
                </T>
            </At>
        </Stage>
    );
}
