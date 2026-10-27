import { Clock, ShieldCheck, Zap } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Los dos modos de mantener la tienda al día. En tiempo real, cada cambio de
 * la tienda llega a la app en segundos (la tienda avisa). Cada cierto tiempo,
 * los cambios se juntan y llegan en tandas. En tiempo real igual hay una
 * revisión cada hora, por si algún aviso se perdió.
 */

const L1Y = 98;
const L2Y = 190;
const X0 = 132;
const X1 = 322;

const CSS = `
@keyframes ts-p1{0%,6%{opacity:0;transform:translateX(0)}8%{opacity:1}16%{opacity:1;transform:translateX(${X1 - X0}px)}18%,100%{opacity:0;transform:translateX(${X1 - X0}px)}}
@keyframes ts-p2{0%,36%{opacity:0;transform:translateX(0)}38%{opacity:1}46%{opacity:1;transform:translateX(${X1 - X0}px)}48%,100%{opacity:0;transform:translateX(${X1 - X0}px)}}
@keyframes ts-p3{0%,62%{opacity:0;transform:translateX(0)}64%{opacity:1}72%{opacity:1;transform:translateX(${X1 - X0}px)}74%,100%{opacity:0;transform:translateX(${X1 - X0}px)}}
@keyframes ts-q1{0%,6%{opacity:0;transform:translateX(0)}8%{opacity:1}14%,76%{opacity:1;transform:translateX(56px)}86%{opacity:1;transform:translateX(${X1 - X0}px)}88%,100%{opacity:0;transform:translateX(${X1 - X0}px)}}
@keyframes ts-q2{0%,36%{opacity:0;transform:translateX(0)}38%{opacity:1}44%,76%{opacity:1;transform:translateX(44px)}86%{opacity:1;transform:translateX(${X1 - X0}px)}88%,100%{opacity:0;transform:translateX(${X1 - X0}px)}}
@keyframes ts-q3{0%,62%{opacity:0;transform:translateX(0)}64%{opacity:1}70%,76%{opacity:1;transform:translateX(32px)}86%{opacity:1;transform:translateX(${X1 - X0}px)}88%,100%{opacity:0;transform:translateX(${X1 - X0}px)}}
@keyframes ts-r1{0%,16%{opacity:0;transform:translateY(-4px)}19%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ts-r2{0%,46%{opacity:0;transform:translateY(-4px)}49%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ts-r3{0%,72%{opacity:0;transform:translateY(-4px)}75%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ts-b{0%,86%{opacity:0;transform:translateY(-4px)}89%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ts-hand{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes ts-gate{0%,76%{background:${C.card}}79%,86%{background:${primary(0.16)}}90%,100%{background:${C.card}}}
`;

const EVENTS = ['Pedido #1044', 'Stock 18 → 17', 'Pedido #1045'];

function Dot({ a, y, t }: { a: string; y: number; t: 'mint' | 'blue' }): JSX.Element {
    return <At x={X0} y={y - 5} w={10} h={10} a={a} style={{ borderRadius: 99, background: tone(t), boxShadow: `0 0 0 3px ${tone(t, 0.2)}`, opacity: 0 }} />;
}

function Rows({ items, anims }: { items: string[]; anims: string[] }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {items.map((txt, i) => (
                <span key={txt} data-a="" style={{ animationName: anims[i], height: 16, borderRadius: 4, background: C.muted, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                    <T size={8}>{txt}</T>
                </span>
            ))}
        </span>
    );
}

export default function TiendaSync(): JSX.Element {
    return (
        <Stage label="En tiempo real, cada cambio de la tienda llega a la app en segundos. Cada cierto tiempo, los cambios se juntan y llegan en tandas. En tiempo real igual hay una revisión cada hora por si algún aviso se perdió." tint="blue">
            <Keyframes css={CSS} />

            {/* La tienda */}
            <At x={16} y={92} w={104} h={112} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 12px 28px -16px rgba(15,23,42,.5)' }}>
                <IntegrationLogo integrationKey="woocommerce" size={34} />
                <T size={9.5} weight={700}>
                    Tu tienda
                </T>
                <T size={7.5} color={C.mutedFg}>
                    3 cambios
                </T>
            </At>

            {/* Carril 1: tiempo real */}
            <At x={X0} y={L1Y - 50} w={200} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: tone('mint', 0.16), color: tone('mint'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Zap size={11} />
                </span>
                <T size={9.5} weight={700}>
                    En tiempo real
                </T>
                <span style={{ height: 14, padding: '0 5px', borderRadius: 4, background: tone('mint', 0.16), color: tone('mint'), fontSize: 7, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Recomendado</span>
            </At>
            <At x={X0} y={L1Y - 29} w={196}>
                <T size={8} color={C.mutedFg}>
                    La tienda avisa: cada cambio llega en segundos.
                </T>
            </At>
            <At x={X0} y={L1Y - 1} w={X1 - X0 + 10} h={2} style={{ background: tone('mint', 0.35), borderRadius: 2 }} />
            <Dot a="ts-p1" y={L1Y} t="mint" />
            <Dot a="ts-p2" y={L1Y} t="mint" />
            <Dot a="ts-p3" y={L1Y} t="mint" />

            {/* Carril 2: cada cierto tiempo */}
            <At x={X0} y={L2Y - 54} w={200} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: tone('blue', 0.16), color: tone('blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Clock size={11} />
                </span>
                <T size={9.5} weight={700}>
                    Cada cierto tiempo
                </T>
            </At>
            <At x={X0} y={L2Y - 33} w={196}>
                <T size={8} color={C.mutedFg}>
                    Los cambios se juntan y llegan en tandas.
                </T>
            </At>
            <At x={X0} y={L2Y - 1} w={X1 - X0 + 10} h={2} style={{ background: tone('blue', 0.3), borderRadius: 2 }} />
            {/* La espera (reloj) */}
            <At x={X0 + 74} y={L2Y - 11} w={22} h={22} a="ts-gate" style={{ borderRadius: 99, border: `1.5px solid ${tone('blue', 0.6)}`, background: C.card, zIndex: 2 }}>
                <span data-a="" style={{ animationName: 'ts-hand', animationTimingFunction: 'linear', position: 'absolute', left: 10, top: 3, width: 1.5, height: 8, background: tone('blue'), transformOrigin: '0.75px 8px' }} />
            </At>
            <Dot a="ts-q1" y={L2Y} t="blue" />
            <Dot a="ts-q2" y={L2Y} t="blue" />
            <Dot a="ts-q3" y={L2Y} t="blue" />

            {/* En la app */}
            <At x={X1 + 14} y={L1Y - 42} w={130} h={84} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <T size={8.5} weight={700}>
                    En la app
                </T>
                <Rows items={EVENTS} anims={['ts-r1', 'ts-r2', 'ts-r3']} />
            </At>
            <At x={X1 + 14} y={L2Y - 42} w={130} h={84} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <T size={8.5} weight={700}>
                    En la app
                </T>
                <Rows items={EVENTS} anims={['ts-b', 'ts-b', 'ts-b']} />
            </At>

            {/* Red de seguridad */}
            <At x={X0} y={250} w={334} style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.card, border: `1px dashed ${C.border}`, borderRadius: 9, padding: '6px 9px' }}>
                <ShieldCheck size={13} color={primary()} />
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    En tiempo real igual se revisa la tienda cada hora, por si algún aviso no llegó.
                </T>
            </At>
        </Stage>
    );
}
