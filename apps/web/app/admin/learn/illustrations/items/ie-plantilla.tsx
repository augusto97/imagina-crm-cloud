import { Briefcase, ClipboardList, Receipt, Rocket, Users } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Guardar una lista como plantilla: se le pone nombre y categoría, se elige
 * qué incluir y aparece en «Mis plantillas» de la galería de «Nueva lista».
 */

const CSS = `
@keyframes pl-type{0%,6%{width:0}24%,100%{width:118px}}
@keyframes pl-save{0%,38%{opacity:1;transform:scale(1)}44%,92%{opacity:0;transform:scale(.96)}97%,100%{opacity:1;transform:scale(1)}}
@keyframes pl-press{0%,32%{transform:scale(1)}34%{transform:scale(.93)}37%,100%{transform:scale(1)}}
@keyframes pl-gal{0%,42%{opacity:0;transform:translateY(10px)}50%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pl-new{0%,52%{opacity:0;transform:scale(.8)}58%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes pl-glow{0%,58%{box-shadow:0 0 0 0 ${primary(0)}}64%{box-shadow:0 0 0 5px ${primary(0.25)}}76%,100%{box-shadow:0 0 0 0 ${primary(0)}}}
@keyframes pl-cur{0%{transform:translate(300px,290px);opacity:0}5%{opacity:1}24%{transform:translate(330px,240px)}30%,34%{transform:translate(338px,258px)}44%{opacity:1}48%,100%{opacity:0;transform:translate(338px,258px)}}
@keyframes pl-ring{0%,31%{opacity:0;transform:scale(.4)}33%{opacity:1;transform:scale(1)}37%,100%{opacity:0;transform:scale(1.6)}}
`;

function Check({ on }: { on: boolean }): JSX.Element {
    return (
        <span style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${on ? primary() : C.mutedFg}`, background: on ? primary() : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.primaryFg, fontSize: 7, fontWeight: 800, flexShrink: 0 }}>{on ? '✓' : ''}</span>
    );
}

function Card({ icon, title, cat, t, children, a }: { icon: JSX.Element; title: string; cat: string; t: 'violet' | 'blue' | 'mint' | 'amber'; children?: JSX.Element; a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 9, border: `1px solid ${a ? primary() : C.border}`, background: C.card, animationName: a }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: tone(t), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={8} weight={700}>
                        {title}
                    </T>
                    <T size={6.5} color={C.mutedFg}>
                        {cat}
                    </T>
                </span>
            </span>
            {children}
        </span>
    );
}

export default function IePlantilla(): JSX.Element {
    return (
        <Stage label="Desde la configuración de una lista se toca Guardar como plantilla, se escribe el nombre y se elige qué incluir; la plantilla aparece en Mis plantillas al crear una lista nueva." tint="violet">
            <Keyframes css={CSS} />
            {/* Diálogo de guardar */}
            <At x={90} y={18} w={300} h={264} a="pl-save" style={{ zIndex: 3, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -18px rgba(15,23,42,.6)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <T size={10.5} weight={700}>
                    Guardar como plantilla
                </T>
                <T size={7.5} weight={600}>
                    Nombre de la plantilla
                </T>
                <span style={{ height: 21, borderRadius: 6, border: `1.5px solid ${primary()}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                    <span data-a="" style={{ display: 'flex', overflow: 'hidden', width: 118, animationName: 'pl-type', animationTimingFunction: 'steps(22, end)' }}>
                        <T size={8.5}>Pipeline de mi agencia</T>
                    </span>
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                    <span style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600}>
                            Descripción
                        </T>
                        <span style={{ height: 21, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={7.5} color={C.mutedFg}>
                                Etapas, monto y fecha de cierre
                            </T>
                        </span>
                    </span>
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600}>
                            Categoría
                        </T>
                        <span style={{ height: 21, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={7.5}>Ventas</T>
                        </span>
                    </span>
                </span>
                <T size={7.5} weight={700} style={{ marginTop: 2 }}>
                    Incluir
                </T>
                {[
                    ['Vistas guardadas', true],
                    ['Automatizaciones', true],
                    ['Ajustes (permisos, apariencia)', true],
                    ['Registros como datos de ejemplo (hasta 500)', false],
                ].map(([l, on]) => (
                    <span key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Check on={on as boolean} />
                        <T size={7.5}>{l as string}</T>
                    </span>
                ))}
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 'auto' }}>
                    <Btn kind="outline" label="Cancelar" style={{ height: 20, fontSize: 8 }} />
                    <span data-a="" style={{ display: 'flex', animationName: 'pl-press' }}>
                        <Btn label="Guardar plantilla" style={{ height: 20, fontSize: 8 }} />
                    </span>
                </span>
            </At>

            {/* Galería */}
            <At x={20} y={40} w={440} h={214} a="pl-gal" style={{ opacity: 0, zIndex: 4, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -18px rgba(15,23,42,.55)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <T size={10.5} weight={700}>
                    Nueva lista
                </T>
                <span style={{ display: 'flex', gap: 3, padding: 2, borderRadius: 7, background: C.muted }}>
                    {['Plantilla', 'En blanco', 'Duplicar'].map((l, i) => (
                        <span key={l} style={{ flex: 1, textAlign: 'center', fontSize: 8, fontWeight: i === 0 ? 700 : 500, padding: '3px 0', borderRadius: 5, background: i === 0 ? C.card : 'transparent', color: i === 0 ? C.fg : C.mutedFg }}>
                            {l}
                        </span>
                    ))}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                    {['Todas', 'Mis plantillas', 'Ventas', 'Clientes', 'Proyectos', 'Finanzas'].map((l) => (
                        <span key={l} style={{ padding: '2px 8px', borderRadius: 99, fontSize: 7.5, fontWeight: 600, border: `1px solid ${l === 'Mis plantillas' ? primary() : C.border}`, background: l === 'Mis plantillas' ? primary(0.1) : 'transparent', color: l === 'Mis plantillas' ? primary() : C.mutedFg }}>
                            {l}
                        </span>
                    ))}
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <span data-a="" style={{ display: 'flex', animationName: 'pl-new' }}>
                        <span style={{ flex: 1, display: 'flex' }}>
                            <Card icon={<Rocket size={11} />} title="Pipeline de mi agencia" cat="Ventas · de tu empresa" t="violet" a="pl-glow">
                                <T size={6.5} color={C.mutedFg}>
                                    8 campos · 3 vistas · 2 automatizaciones
                                </T>
                            </Card>
                        </span>
                    </span>
                    <Card icon={<Receipt size={11} />} title="Cotizaciones" cat="Ventas · de tu empresa" t="amber">
                        <T size={6.5} color={C.mutedFg}>
                            10 campos · 2 vistas
                        </T>
                    </Card>
                    <Card icon={<Users size={11} />} title="Clientes con sede" cat="Clientes · de tu empresa" t="blue">
                        <T size={6.5} color={C.mutedFg}>
                            9 campos · 1 vista
                        </T>
                    </Card>
                    <Card icon={<Briefcase size={11} />} title="Proyectos por cliente" cat="Proyectos · de tu empresa" t="mint">
                        <T size={6.5} color={C.mutedFg}>
                            11 campos · 4 vistas · 1 tablero
                        </T>
                    </Card>
                    <Card icon={<ClipboardList size={11} />} title="Visitas técnicas" cat="Operaciones · de tu empresa" t="blue">
                        <T size={6.5} color={C.mutedFg}>
                            7 campos · 2 vistas
                        </T>
                    </Card>
                </span>
            </At>
            <Cursor a="pl-cur" click="pl-ring" rest={[338, 258]} />
        </Stage>
    );
}
