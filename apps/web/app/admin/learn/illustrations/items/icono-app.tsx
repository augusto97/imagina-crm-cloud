import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.343 — El ícono de la app instalada: antes, el logo chico sobre un plato
 * blanco (un círculo dentro de otro); después, un ícono de app con el color
 * del logo de borde a borde y la marca en blanco. A la derecha, la pantalla
 * con que abre la app en Android: el ícono en un círculo sobre el fondo.
 * El cuadro final (el que se ve con «reducir movimiento») es el «después».
 */

const CSS = `
@keyframes ia-before{0%,34%{opacity:1;transform:scale(1)}42%,100%{opacity:0;transform:scale(.86)}}
@keyframes ia-after{0%,34%{opacity:0;transform:scale(.86)}44%{opacity:1;transform:scale(1.06)}50%,100%{opacity:1;transform:scale(1)}}
@keyframes ia-tag-before{0%,34%{opacity:1}40%,100%{opacity:0}}
@keyframes ia-tag-after{0%,40%{opacity:0}48%,100%{opacity:1}}
@keyframes ia-open{0%,52%{opacity:0;transform:scale(.6)}62%{opacity:1;transform:scale(1.08)}68%,100%{opacity:1;transform:scale(1)}}
`;

const GRAD = `linear-gradient(135deg, ${primary(0.92)} 0%, ${tone('cyan')} 100%)`;

/** La marca en blanco: una montaña con rayas, como un isotipo. */
function Mark({ size }: { size: number }): JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
            <polygon points="50,12 82,88 18,88" fill="#fff" />
            {[0, 1, 2, 3].map((i) => (
                <line key={i} x1={64 + i * 6} y1={52 + i * 8} x2={86 + i * 2} y2={40 + i * 8} stroke="#fff" strokeWidth={3.2} strokeLinecap="round" />
            ))}
        </svg>
    );
}

function Icon({ x, y, a, before }: { x: number; y: number; a: string; before?: boolean }): JSX.Element {
    if (before) {
        return (
            <At x={x} y={y} w={64} h={64} a={a} style={{ borderRadius: 32, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(0,0,0,.28)', opacity: 0 }}>
                <span style={{ width: 34, height: 34, borderRadius: 17, background: GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mark size={24} />
                </span>
            </At>
        );
    }
    return (
        <At x={x} y={y} w={64} h={64} a={a} style={{ borderRadius: 20, background: GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(0,0,0,.28)' }}>
            <Mark size={42} />
        </At>
    );
}

export default function IconoApp(): JSX.Element {
    return (
        <Stage
            label="El ícono de la app en el inicio del teléfono: primero el logo pequeño sobre un plato blanco; después un ícono de app con el color del logo de borde a borde y la marca en blanco. A la derecha, la app abriendo con ese ícono en el centro."
            tint="cyan"
            cycle={8}
        >
            <Keyframes css={CSS} />
            {/* El inicio del teléfono */}
            <At x={26} y={36} w={214} h={228} style={{ borderRadius: 22, background: 'linear-gradient(160deg, #5c7ba1 0%, #34465f 55%, #1c2533 100%)', boxShadow: '0 22px 44px -22px rgba(15,23,42,.55)' }}>
                {[0, 1, 2].map((i) => (
                    <At key={i} x={22 + i * 62} y={26} w={46} h={46} style={{ borderRadius: 14, background: 'rgba(255,255,255,.16)' }} />
                ))}
                <Icon x={75} y={96} a="ia-before" before />
                <Icon x={75} y={96} a="ia-after" />
                <At x={40} y={166} w={134} h={14} style={{ textAlign: 'center' }}>
                    <T size={9} weight={600} color="#fff">
                        Mi app
                    </T>
                </At>
                <At x={20} y={192} w={174} h={20} a="ia-tag-before" style={{ textAlign: 'center', opacity: 0 }}>
                    <T size={8.5} color="rgba(255,255,255,.8)">
                        Antes: el logo sobre un plato blanco
                    </T>
                </At>
                <At x={20} y={192} w={174} h={20} a="ia-tag-after" style={{ textAlign: 'center' }}>
                    <T size={8.5} weight={600} color="#fff">
                        Ahora: un ícono de app
                    </T>
                </At>
            </At>

            {/* La app abriendo en Android */}
            <At x={290} y={20} w={150} h={262} style={{ borderRadius: 24, background: '#fff', border: `5px solid ${C.fg}`, boxShadow: '0 22px 44px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <At x={42} y={92} w={56} h={56} a="ia-open" style={{ borderRadius: 28, background: GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Mark size={36} />
                </At>
                <At x={0} y={210} w={140} h={16} style={{ textAlign: 'center' }}>
                    <T size={8.5} color="#64748b">
                        Al abrir la app
                    </T>
                </At>
            </At>
        </Stage>
    );
}
