import { Keyboard, ListChecks, Pin, Table } from 'lucide-react';

import { At, Bar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Atajos de teclado: «g» y después «t» lleva a Mi trabajo, «g» y «f» a
 * Favoritos, y «?» muestra la lista completa de atajos.
 */

const CSS = `
@keyframes at-k1{0%,8%{opacity:0;transform:translateY(8px)}11%,30%{opacity:1;transform:translateY(0)}34%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes at-k2{0%,38%{opacity:0;transform:translateY(8px)}41%,60%{opacity:1;transform:translateY(0)}64%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes at-k3{0%,66%{opacity:0;transform:translateY(8px)}69%,92%{opacity:1;transform:translateY(0)}96%,100%{opacity:0}}
@keyframes at-press1{0%,10%{transform:translateY(0)}12%{transform:translateY(3px)}14%,100%{transform:translateY(0)}}
@keyframes at-press2{0%,17%{transform:translateY(0)}19%{transform:translateY(3px)}21%,100%{transform:translateY(0)}}
@keyframes at-press3{0%,42%{transform:translateY(0)}44%{transform:translateY(3px)}46%,100%{transform:translateY(0)}}
@keyframes at-press4{0%,47%{transform:translateY(0)}49%{transform:translateY(3px)}51%,100%{transform:translateY(0)}}
@keyframes at-s1{0%,21%{opacity:1}24%,96%{opacity:0}100%{opacity:1}}
@keyframes at-s2{0%,21%{opacity:0}24%,50%{opacity:1}53%,100%{opacity:0}}
@keyframes at-s3{0%,50%{opacity:0}53%,96%{opacity:1}100%{opacity:0}}
@keyframes at-dlg{0%,69%{opacity:0;transform:translateY(8px) scale(.97)}73%,92%{opacity:1;transform:translateY(0) scale(1)}96%,100%{opacity:0}}
`;

function Key({ label, a, wide }: { label: string; a?: string; wide?: boolean }): JSX.Element {
    return (
        <span
            data-a={a ? '' : undefined}
            style={{
                width: wide ? 64 : 44,
                height: 44,
                borderRadius: 9,
                background: C.card,
                border: `1px solid ${C.border}`,
                boxShadow: `0 4px 0 ${C.border}, 0 14px 24px -14px rgba(15,23,42,.55)`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 700,
                color: C.fg,
                animationName: a,
            }}
        >
            {label}
        </span>
    );
}

function Combo({ a, keys, text, base }: { a: string; keys: string[]; text: string; base: number }): JSX.Element {
    return (
        <At x={20} y={96} w={148} a={a} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: base }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {keys.map((k, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {i > 0 && (
                            <T size={8.5} color={C.mutedFg}>
                                luego
                            </T>
                        )}
                        <Key label={k} a={keys.length > 1 ? (a === 'at-k1' ? (i === 0 ? 'at-press1' : 'at-press2') : i === 0 ? 'at-press3' : 'at-press4') : undefined} />
                    </span>
                ))}
            </span>
            <span style={{ display: 'flex', padding: '3px 9px', borderRadius: 99, background: primary(0.12) }}>
                <T size={9} weight={700} color={primary()}>
                    {text}
                </T>
            </span>
        </At>
    );
}

function Screen({ a, base, icon, title, rows }: { a: string; base: number; icon: JSX.Element; title: string; rows: Array<[string, 'rose' | 'amber' | 'blue' | 'mint' | 'violet']> }): JSX.Element {
    return (
        <At x={0} y={0} w={286} h={240} a={a} style={{ opacity: base }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: primary(), display: 'flex' }}>{icon}</span>
                <T size={10.5} weight={700}>
                    {title}
                </T>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '4px 12px' }}>
                {rows.map(([r, t]) => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 8, height: 8, borderRadius: 3, background: tone(t) }} />
                        <T size={9} weight={600} style={{ flex: 1 }}>
                            {r}
                        </T>
                        <Bar w={36} h={5} />
                    </div>
                ))}
            </div>
        </At>
    );
}

export default function PpAtajos(): JSX.Element {
    return (
        <Stage label="Se aprietan las teclas g y después t y la app salta a Mi trabajo; g y f lleva a Favoritos; y la tecla del signo de pregunta muestra la lista de atajos." tint="slate">
            <Keyframes css={CSS} />
            <At x={30} y={36} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Keyboard size={13} color={C.mutedFg} />
                <T size={9.5} weight={700} color={C.mutedFg}>
                    Teclado
                </T>
            </At>
            <Combo a="at-k1" keys={['g', 't']} text="Ir a Mi trabajo" base={0} />
            <Combo a="at-k2" keys={['g', 'f']} text="Ir a Favoritos" base={0} />
            <Combo a="at-k3" keys={['?']} text="Ver todos los atajos" base={1} />

            {/* La app */}
            <At x={178} y={30} w={286} h={240} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <Screen
                    a="at-s1"
                    base={0}
                    icon={<Table size={12} />}
                    title="Listas"
                    rows={[
                        ['Oportunidades', 'violet'],
                        ['Clientes', 'blue'],
                        ['Facturas', 'mint'],
                        ['Tareas', 'amber'],
                        ['Tickets', 'rose'],
                    ]}
                />
                <Screen
                    a="at-s2"
                    base={0}
                    icon={<ListChecks size={12} />}
                    title="Mi trabajo"
                    rows={[
                        ['Llamar a Clínica Norte', 'rose'],
                        ['Enviar cotización', 'amber'],
                        ['Revisar contrato', 'amber'],
                        ['Visita a Hotel Brisas', 'blue'],
                    ]}
                />
                <Screen
                    a="at-s3"
                    base={1}
                    icon={<Pin size={12} />}
                    title="Favoritos"
                    rows={[
                        ['Oportunidades', 'violet'],
                        ['Facturas', 'mint'],
                        ['Ventas del mes', 'blue'],
                    ]}
                />
                {/* Diálogo de atajos */}
                <At x={22} y={30} w={242} h={196} a="at-dlg" style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -16px rgba(15,23,42,.6)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <T size={10.5} weight={700}>
                        Atajos de teclado
                    </T>
                    {[
                        [['Ctrl', 'K'], 'Buscar y abrir cualquier cosa'],
                        [['?'], 'Mostrar estos atajos'],
                        [['g', 'l'], 'Ir a Listas'],
                        [['g', 't'], 'Ir a Mi trabajo'],
                        [['g', 'f'], 'Ir a Favoritos'],
                        [['g', 'd'], 'Ir a Dashboards'],
                        [['g', 's'], 'Ir a Ajustes'],
                        [['Esc'], 'Cerrar un panel o diálogo'],
                    ].map(([ks, txt]) => (
                        <div key={txt as string} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 16 }}>
                            <T size={8.5}>{txt as string}</T>
                            <span style={{ display: 'flex', gap: 3 }}>
                                {(ks as string[]).map((k) => (
                                    <span key={k} style={{ fontSize: 7.5, fontWeight: 700, minWidth: 14, textAlign: 'center', padding: '1px 4px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.muted, color: C.fg }}>
                                        {k}
                                    </span>
                                ))}
                            </span>
                        </div>
                    ))}
                </At>
            </At>
        </Stage>
    );
}
