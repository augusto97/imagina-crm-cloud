import {
    BadgeDollarSign,
    CalendarCheck,
    CalendarClock,
    ClipboardCheck,
    ClipboardList,
    Clock,
    Inbox,
    ListTodo,
    MessageCircle,
    MousePointerClick,
    PenLine,
    Replace,
    Sparkles,
    Timer,
    Webhook,
} from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Los disparadores: todo lo que puede poner a correr una automatización, por familia. */

type Tn = 'blue' | 'amber' | 'mint' | 'violet';
const TILES: Array<{ l: string; i: JSX.Element; t: Tn }> = [
    { l: 'Se crea un registro', i: <Sparkles size={13} />, t: 'blue' },
    { l: 'Se modifica un registro', i: <PenLine size={13} />, t: 'blue' },
    { l: 'Cambia un campo', i: <Replace size={13} />, t: 'blue' },
    { l: 'Llega una fecha', i: <CalendarClock size={13} />, t: 'amber' },
    { l: 'En un horario', i: <Clock size={13} />, t: 'amber' },
    { l: 'Llega un webhook', i: <Webhook size={13} />, t: 'mint' },
    { l: 'Se envía un formulario', i: <ClipboardList size={13} />, t: 'mint' },
    { l: 'Se recibe un pago', i: <BadgeDollarSign size={13} />, t: 'mint' },
    { l: 'Llega un WhatsApp', i: <MessageCircle size={13} />, t: 'mint' },
    { l: 'Llega un correo', i: <Inbox size={13} />, t: 'mint' },
    { l: 'Se presiona un botón', i: <MousePointerClick size={13} />, t: 'violet' },
    { l: 'Se aprueba o se rechaza', i: <ClipboardCheck size={13} />, t: 'violet' },
    { l: 'Se completa un checklist', i: <ListTodo size={13} />, t: 'violet' },
    { l: 'Se agenda una cita', i: <CalendarCheck size={13} />, t: 'violet' },
    { l: 'Un SLA se vence', i: <Timer size={13} />, t: 'violet' },
];

const COLS = 5;
const TW = 80;
const TH = 58;
const GX = 6;
const GY = 8;
const OX = 11;
const OY = 30;
const pos = (i: number): [number, number] => [OX + (i % COLS) * (TW + GX), OY + Math.floor(i / COLS) * (TH + GY)];

// El aro recorre cinco disparadores, uno de cada familia.
const SPOT = [0, 3, 6, 11, 8];
const ringFrames = (() => {
    const at = SPOT.map(pos);
    const steps = [26, 40, 54, 68, 82];
    let f = `0%,${steps[0]! - 2}%{opacity:0;transform:translate(${at[0]![0]}px,${at[0]![1]}px)}`;
    steps.forEach((p, k) => {
        const [x, y] = at[k]!;
        f += `${p}%,${p + 9}%{opacity:1;transform:translate(${x}px,${y}px)}`;
    });
    f += `96%,100%{opacity:0;transform:translate(${at[4]![0]}px,${at[4]![1]}px)}`;
    return f;
})();

const CSS = `
@keyframes ad-in{0%{opacity:0;transform:translateY(8px) scale(.94)}8%,94%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(0) scale(1)}}
@keyframes ad-ring{${ringFrames}}
`;

const LEGEND: Array<[string, Tn]> = [
    ['De los registros', 'blue'],
    ['Fechas y horarios', 'amber'],
    ['Desde afuera', 'mint'],
    ['De otras partes de la app', 'violet'],
];

export default function AutoDisparadores(): JSX.Element {
    return (
        <Stage label="Quince disparadores agrupados por familia: de los registros, fechas y horarios, desde afuera de la app y de otras partes de la app como formularios, aprobaciones o citas." tint="violet">
            <Keyframes css={CSS} />
            <Win x={20} y={18} w={440} h={266} title="Cuando… (el disparador)">
                <At x={OX} y={8} style={{ display: 'flex', gap: 10 }}>
                    {LEGEND.map(([l, t]) => (
                        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 2, background: tone(t) }} />
                            <T size={7.6} color={C.mutedFg}>
                                {l}
                            </T>
                        </span>
                    ))}
                </At>
                {TILES.map((tile, i) => {
                    const [x, y] = pos(i);
                    return (
                        <At
                            key={tile.l}
                            x={x}
                            y={y}
                            w={TW}
                            h={TH}
                            a="ad-in"
                            style={{
                                animationDelay: `${i * 0.06}s`,
                                background: tone(tile.t, 0.07),
                                border: `1px solid ${tone(tile.t, 0.25)}`,
                                borderRadius: 9,
                                padding: '7px 6px 6px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 5,
                            }}
                        >
                            <span style={{ width: 22, height: 22, borderRadius: 6, background: tone(tile.t), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{tile.i}</span>
                            <T size={7.8} weight={600} style={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
                                {tile.l}
                            </T>
                        </At>
                    );
                })}
                <At
                    x={0}
                    y={0}
                    w={TW}
                    h={TH}
                    a="ad-ring"
                    style={{ opacity: 0, borderRadius: 10, boxShadow: `0 0 0 2.5px ${primary(0.8)}, 0 10px 24px -10px ${primary(0.6)}`, pointerEvents: 'none' }}
                />
            </Win>
        </Stage>
    );
}
