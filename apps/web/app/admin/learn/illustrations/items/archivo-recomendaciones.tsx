import { Bell, CalendarDays, Check, CheckCircle2, Columns3, LayoutDashboard } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.339 — Al terminar «Crear desde un archivo», recomendaciones para los
 * datos: un tablero por estado, un calendario, un tablero y automatizaciones.
 * Nada se crea solo: se aprueba con un clic.
 */

const CSS = `
@keyframes ar-b1{0%,26%{opacity:1}30%,100%{opacity:0}}
@keyframes ar-d1{0%,26%{opacity:0;transform:scale(.9)}30%,100%{opacity:1;transform:scale(1)}}
@keyframes ar-b2{0%,52%{opacity:1}56%,100%{opacity:0}}
@keyframes ar-d2{0%,52%{opacity:0;transform:scale(.9)}56%,100%{opacity:1;transform:scale(1)}}
@keyframes ar-c1{0%,26%{border-color:${C.border}}30%,100%{border-color:${tone('mint', 0.6)};background:${tone('mint', 0.06)}}}
@keyframes ar-c2{0%,52%{border-color:${C.border}}56%,100%{border-color:${tone('mint', 0.6)};background:${tone('mint', 0.06)}}}
@keyframes ar-cur{0%{transform:translate(380px,40px);opacity:0}6%{opacity:1;transform:translate(380px,40px)}22%,27%{transform:translate(176px,124px)}46%,53%{transform:translate(404px,124px)}80%{opacity:1;transform:translate(404px,124px)}90%,100%{opacity:0}}
@keyframes ar-ring{0%,25%{opacity:0;transform:scale(.4)}27%{opacity:1;transform:scale(1)}31%{opacity:0;transform:scale(1.6)}51%{opacity:0;transform:scale(.4)}53%{opacity:1;transform:scale(1)}57%,100%{opacity:0;transform:scale(1.6)}}
`;

function Card({ x, y, icon, title, text, button, a, b, d }: { x: number; y: number; icon: JSX.Element; title: string; text: string; button: string; a?: string; b?: string; d?: string }): JSX.Element {
    return (
        <At x={x} y={y} w={218} h={86} a={a} style={{ display: 'flex', gap: 8, padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.card }}>
            <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, background: primary(0.1), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, position: 'relative', flex: 1 }}>
                <T size={8.5} weight={700}>
                    {title}
                </T>
                <T size={6.8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    {text}
                </T>
                <span style={{ position: 'relative', height: 18, marginTop: 'auto' }}>
                    <span data-a={b ? '' : undefined} style={{ position: 'absolute', left: 0, top: 0, display: 'flex', ...(b ? { animationName: b, opacity: 0 } : null) }}>
                        <Btn kind="outline" label={button} style={{ height: 17, fontSize: 7.5 }} />
                    </span>
                    {d && (
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 2, display: 'flex', alignItems: 'center', gap: 3, animationName: d }}>
                            <Check size={9} color={tone('mint')} />
                            <T size={7.5} weight={700} color={tone('mint')}>
                                Creado · ver
                            </T>
                        </span>
                    )}
                </span>
            </span>
        </At>
    );
}

export default function ArchivoRecomendaciones(): JSX.Element {
    return (
        <Stage label="Tras crear las listas, la app recomienda un tablero por estado, un calendario, un tablero de cartera y un recordatorio de pago; se aprueban con un clic y quedan marcados como creados." tint="blue" cycle={8}>
            <Keyframes css={CSS} />
            <At x={0} y={16} w={480} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={18} color={tone('mint')} />
                <T size={11} weight={700}>
                    Listo: creaste 2 listas
                </T>
                <T size={7.5} color={C.mutedFg}>
                    65 registros importados · 60 vínculos entre listas
                </T>
            </At>
            <Card x={14} y={78} icon={<Columns3 size={12} />} title="Tablero por «Estado»" text="Tarjetas por columna según el estado; se mueven arrastrando." button="Crear vista" a="ar-c1" b="ar-b1" d="ar-d1" />
            <Card x={246} y={78} icon={<LayoutDashboard size={12} />} title="Tablero «Cartera y cobros»" text="Cuánto hay facturado y cuánto falta cobrar, por estado." button="Crear tablero" a="ar-c2" b="ar-b2" d="ar-d2" />
            <Card x={14} y={174} icon={<CalendarDays size={12} />} title="Calendario de «Vence»" text="Las facturas en el mes, la semana o el día." button="Crear vista" />
            <Card x={246} y={174} icon={<Bell size={12} />} title="Recordatorio de pago" text="Antes del vencimiento, un aviso si sigue sin pagar." button="Ver y activar" />
            <Cursor a="ar-cur" click="ar-ring" rest={[404, 124]} />
        </Stage>
    );
}
