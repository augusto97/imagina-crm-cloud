import { CalendarDays, Copy, Store, Users, Zap } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Duplicar una lista: se elige qué copiar (vistas, automatizaciones,
 * ajustes, registros) y la copia aparece en el menú con todo armado.
 */

const CSS = `
@keyframes du-type{0%,8%{width:0}26%,100%{width:92px}}
@keyframes du-old{0%,8%{opacity:1}10%,100%{opacity:0}}
@keyframes du-dlg{0%,44%{opacity:1;transform:scale(1)}50%,92%{opacity:0;transform:scale(.96)}97%,100%{opacity:1;transform:scale(1)}}
@keyframes du-press{0%,38%{transform:scale(1)}40%{transform:scale(.93)}43%,100%{transform:scale(1)}}
@keyframes du-item{0%,46%{opacity:0;transform:translateX(-10px);max-height:0}52%,92%{opacity:1;transform:translateX(0);max-height:24px}97%,100%{opacity:0;max-height:0}}
@keyframes du-glow{0%,52%{background:transparent}56%,74%{background:${primary(0.14)}}84%,100%{background:transparent}}
@keyframes du-card{0%,54%{opacity:0;transform:translateY(8px)}62%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes du-cur{0%{transform:translate(300px,290px);opacity:0}5%{opacity:1}30%{transform:translate(380px,240px)}36%,40%{transform:translate(428px,261px)}50%{opacity:1}56%,100%{opacity:0;transform:translate(428px,261px)}}
@keyframes du-ring{0%,37%{opacity:0;transform:scale(.4)}39%{opacity:1;transform:scale(1)}43%,100%{opacity:0;transform:scale(1.6)}}
`;

function Check({ on }: { on: boolean }): JSX.Element {
    return (
        <span style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${on ? primary() : C.mutedFg}`, background: on ? primary() : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.primaryFg, fontSize: 7, fontWeight: 800, flexShrink: 0 }}>{on ? '✓' : ''}</span>
    );
}

function Item({ icon, name, t }: { icon: JSX.Element; name: string; t: 'blue' | 'amber' | 'violet' | 'mint' }): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22 }}>
            <span style={{ width: 15, height: 15, borderRadius: 4, background: tone(t), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
            <T size={8}>{name}</T>
        </span>
    );
}

export default function IeDuplicar(): JSX.Element {
    return (
        <Stage label="Se duplica la lista Clientes Bogotá con el nombre Clientes Medellín, incluyendo vistas, automatizaciones y ajustes pero no los registros; la copia aparece en el menú con sus campos, vistas y automatizaciones." tint="blue">
            <Keyframes css={CSS} />
            {/* Menú lateral */}
            <At x={12} y={14} w={142} h={272} style={{ background: C.muted, borderRadius: 12, border: `1px solid ${C.border}`, padding: '10px 9px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <T size={9} weight={700} style={{ marginBottom: 6 }}>
                    Café Aurora
                </T>
                <T size={6.5} weight={700} color={C.mutedFg} style={{ marginBottom: 2 }}>
                    ESPACIO DE TRABAJO
                </T>
                <Item icon={<Users size={9} />} name="Clientes Bogotá" t="blue" />
                <span data-a="" style={{ display: 'flex', overflow: 'hidden', borderRadius: 5, animationName: 'du-item' }}>
                    <span data-a="" style={{ flex: 1, display: 'flex', borderRadius: 5, padding: '0 2px', animationName: 'du-glow' }}>
                        <Item icon={<Users size={9} />} name="Clientes Medellín" t="blue" />
                    </span>
                </span>
                <Item icon={<Store size={9} />} name="Inventario" t="amber" />
                <Item icon={<CalendarDays size={9} />} name="Citas" t="violet" />
            </At>

            {/* Diálogo */}
            <At x={168} y={18} w={300} h={264} a="du-dlg" style={{ zIndex: 3, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -18px rgba(15,23,42,.6)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={12} color={primary()} />
                    <T size={10.5} weight={700}>
                        Duplicar lista
                    </T>
                </span>
                <T size={7.5} weight={600}>
                    Lista a duplicar
                </T>
                <span style={{ height: 21, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                    <T size={8}>Clientes Bogotá</T>
                </span>
                <T size={7.5} weight={600}>
                    Nombre de la copia
                </T>
                <span style={{ position: 'relative', height: 21, borderRadius: 6, border: `1.5px solid ${primary()}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                    <span data-a="" style={{ position: 'absolute', left: 7, display: 'flex', animationName: 'du-old', opacity: 0 }}>
                        <T size={8.5} color={C.mutedFg}>
                            Clientes Bogotá (copia)
                        </T>
                    </span>
                    <span data-a="" style={{ display: 'flex', overflow: 'hidden', width: 92, animationName: 'du-type', animationTimingFunction: 'steps(17, end)' }}>
                        <T size={8.5}>Clientes Medellín</T>
                    </span>
                </span>
                <T size={7} weight={700} color={C.mutedFg} style={{ marginTop: 3 }}>
                    INCLUIR
                </T>
                {[
                    ['Vistas guardadas', '', true],
                    ['Automatizaciones', 'Los webhooks entrantes reciben una URL nueva.', true],
                    ['Ajustes', 'La publicación pública no se copia.', true],
                    ['Registros', 'Hasta 500. Los archivos adjuntos no se copian.', false],
                ].map(([l, d, on]) => (
                    <span key={l as string} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                        <Check on={on as boolean} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={7.5}>{l as string}</T>
                            {d && (
                                <T size={6.5} color={C.mutedFg}>
                                    {d as string}
                                </T>
                            )}
                        </span>
                    </span>
                ))}
                <span data-a="" style={{ alignSelf: 'flex-end', display: 'flex', marginTop: 'auto', animationName: 'du-press' }}>
                    <Btn label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Copy size={9} />Duplicar</span>} style={{ height: 20, fontSize: 8 }} />
                </span>
            </At>

            {/* La copia, lista para usar */}
            <At x={180} y={60} w={276} a="du-card" style={{ opacity: 0, zIndex: 4, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: tone('blue'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Users size={14} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={11} weight={700}>
                            Clientes Medellín
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Lista vacía, con todo armado
                        </T>
                    </span>
                </span>
                {[
                    ['11 campos', 'Los mismos de la original, con sus reglas', 'violet'],
                    ['3 vistas', 'Tabla, kanban por estado y calendario', 'blue'],
                    ['2 automatizaciones', 'Bienvenida y recordatorio de cobro', 'amber'],
                ].map(([n, d, t]) => (
                    <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: tone(t as 'blue', 0.15), color: tone(t as 'blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Zap size={9} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={8.5} weight={700}>
                                {n}
                            </T>
                            <T size={7} color={C.mutedFg}>
                                {d}
                            </T>
                        </span>
                    </span>
                ))}
            </At>
            <Cursor a="du-cur" click="du-ring" rest={[428, 261]} />
        </Stage>
    );
}
