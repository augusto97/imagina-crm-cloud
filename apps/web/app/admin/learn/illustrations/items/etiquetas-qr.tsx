import { CheckCircle2, Printer } from 'lucide-react';

import { At, C, Keyframes, Stage, T, anim, primary, tone } from '../kit';

/**
 * v0.1.344 — Etiquetas con QR: una hoja de etiquetas se llena con el QR de
 * cada registro (nombre y código debajo) y, a la derecha, el teléfono
 * escanea una y se abre su ficha. El cuadro final (con «reducir
 * movimiento») es la hoja completa y la ficha abierta.
 */

const CSS = `
@keyframes eq-l{0%,8%{opacity:0;transform:scale(.7)}16%,100%{opacity:1;transform:scale(1)}}
@keyframes eq-scan{0%,52%{transform:translateY(0)}62%{transform:translateY(34px)}72%,100%{transform:translateY(0)}}
@keyframes eq-cam{0%,48%{opacity:0}54%,100%{opacity:1}}
@keyframes eq-open{0%,70%{opacity:0;transform:translateY(8px)}78%,100%{opacity:1;transform:translateY(0)}}
`;

/** Un QR de muestra (dibujo, no codifica nada). */
function Qr({ size }: { size: number }): JSX.Element {
    const n = 7;
    const c = size / n;
    const cells: JSX.Element[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const finder = (i < 3 && j < 3) || (i < 3 && j > 3) || (i > 3 && j < 3);
            const on = finder ? !(i % 3 === 1 && j % 3 === 1) || (i === 1 && (j === 1 || j === 5)) || (i === 5 && j === 1) : (i * 3 + j * 5) % 4 === 0;
            if (on) cells.push(<rect key={`${i}-${j}`} x={j * c} y={i * c} width={c} height={c} fill="#111827" />);
        }
    }
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
            {cells}
        </svg>
    );
}

const ITEMS = ['Taza', 'Libreta', 'Termo', 'Bolso', 'Gorra', 'Agenda', 'Llavero', 'Morral'];

function Label({ name, i }: { name: string; i: number }): JSX.Element {
    const a = anim('eq-l', { animationDelay: `${(i * 0.32).toFixed(2)}s` });
    return (
        <span
            data-a={a['data-a']}
            style={{
                ...a.style,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 6,
                borderRadius: 6,
                background: '#fff',
                border: '1px solid #d4d8df',
                width: 104,
                height: 40,
            }}
        >
            <Qr size={28} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: '#111827' }}>{name}</span>
                <span style={{ fontSize: 7, color: '#6b7280', letterSpacing: '.06em' }}>{`SKU-00${i + 1}`}</span>
            </span>
        </span>
    );
}

export default function EtiquetasQr(): JSX.Element {
    return (
        <Stage
            label="Una hoja de etiquetas adhesivas se llena con el código QR, el nombre y el SKU de cada producto. Al lado, un teléfono escanea una de las etiquetas y se abre la ficha del producto."
            tint="cyan"
            cycle={8}
        >
            <Keyframes css={CSS} />
            {/* La hoja de etiquetas */}
            <At x={20} y={22} w={252} h={256} style={{ borderRadius: 10, background: '#f3f4f6', border: `1px solid ${C.border}`, boxShadow: '0 18px 36px -22px rgba(15,23,42,.5)' }}>
                <At x={12} y={10} w={228} h={16} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Printer size={12} color={primary(0.9)} />
                    <T size={9} weight={700} color={C.fg}>
                        Etiquetas · Productos
                    </T>
                </At>
                <At x={12} y={32} w={228} h={216} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 104px)', gap: 10, justifyContent: 'center' }}>
                    {ITEMS.map((name, i) => (
                        <Label key={name} name={name} i={i} />
                    ))}
                </At>
            </At>

            {/* El teléfono escaneando */}
            <At x={300} y={26} w={158} h={250} style={{ borderRadius: 24, background: '#0f172a', border: '5px solid #0f172a', boxShadow: '0 22px 44px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <At x={0} y={0} w={148} h={240} style={{ background: '#1e293b' }}>
                    <At x={24} y={30} w={100} h={100} a="eq-cam" style={{ borderRadius: 12, border: `2px solid ${tone('cyan')}`, background: 'rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0 }}>
                        <span style={{ background: '#fff', padding: 6, borderRadius: 6 }}>
                            <Qr size={52} />
                        </span>
                        <At x={6} y={16} w={88} h={2} a="eq-scan" style={{ background: tone('cyan'), boxShadow: `0 0 8px ${tone('cyan')}` }} />
                    </At>
                    <At x={10} y={146} w={128} h={78} a="eq-open" style={{ borderRadius: 12, background: '#fff', padding: 10, opacity: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <CheckCircle2 size={12} color={C.success} />
                            <T size={8.5} weight={700} color="#111827">
                                Ficha abierta
                            </T>
                        </span>
                        <span style={{ display: 'block', marginTop: 6 }}>
                            <T size={10} weight={700} color="#111827">
                                Taza
                            </T>
                        </span>
                        <span style={{ display: 'block' }}>
                            <T size={8} color="#6b7280">
                                SKU-001 · Stock 24
                            </T>
                        </span>
                    </At>
                </At>
            </At>
        </Stage>
    );
}
