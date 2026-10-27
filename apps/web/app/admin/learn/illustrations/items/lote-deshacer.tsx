import { History, Undo2, Wand2 } from 'lucide-react';

import { At, Avatar, Btn, C, Cursor, Keyframes, Pill, Stage, T, primary, tone } from '../kit';

/** El historial de ediciones masivas: «Deshacer» vuelve atrás 219 registros y respeta el que alguien cambió después. */

const CSS = `
@keyframes ld-dlg{0%,22%{opacity:0;transform:translateY(8px) scale(.97)}27%,62%{opacity:1;transform:translateY(0) scale(1)}66%,100%{opacity:0;transform:scale(.98)}}
@keyframes ld-veil{0%,22%{opacity:0}27%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes ld-btn1{0%,64%{opacity:1}68%,96%{opacity:0}100%{opacity:1}}
@keyframes ld-done{0%,64%{opacity:0;transform:scale(.9)}68%,95%{opacity:1;transform:scale(1)}99%,100%{opacity:0}}
@keyframes ld-cur{0%{transform:translate(260px,290px);opacity:0}6%{opacity:1}14%,20%{transform:translate(393px,100px)}44%,58%{transform:translate(360px,207px);opacity:1}72%,90%{transform:translate(420px,270px);opacity:1}96%,100%{transform:translate(420px,270px);opacity:0}}
@keyframes ld-ring{0%,16%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1)}20%,55%{opacity:0;transform:scale(1.6)}56%{opacity:1;transform:scale(1)}59%,100%{opacity:0;transform:scale(1.6)}}
`;

function Entry({ y, what, who, ini, when, n, last }: { y: number; what: string; who: string; ini: string; when: string; n: string; last?: boolean }): JSX.Element {
    return (
        <At x={14} y={y} w={402} h={52} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.card }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: primary(0.12), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Wand2 size={13} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <T size={10} weight={700}>
                    {what}
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Avatar initials={ini} t={who === 'Automatización' ? 'cyan' : 'violet'} size={14} />
                    <T size={8.5} color={C.mutedFg}>
                        {who} · {when} · {n}
                    </T>
                </span>
            </span>
            {last ? (
                <span style={{ position: 'relative', width: 150, height: 20 }}>
                    <span data-a="" style={{ position: 'absolute', right: 0, top: 0, opacity: 0, animationName: 'ld-btn1' }}>
                        <Btn label={<><Undo2 size={10} />Deshacer</>} kind="outline" />
                    </span>
                    <span data-a="" style={{ position: 'absolute', right: 0, top: 1, animationName: 'ld-done' }}>
                        <Pill t="slate" label="Deshecha en parte (219 de 220)" />
                    </span>
                </span>
            ) : (
                <Btn label={<><Undo2 size={10} />Deshacer</>} kind="outline" />
            )}
        </At>
    );
}

export default function LoteDeshacer(): JSX.Element {
    return (
        <Stage label="El historial de ediciones masivas de una lista. Al deshacer «Precio: subir 10 %», 219 registros vuelven atrás y uno que alguien cambió después se deja como está; la edición queda «Deshecha en parte»." tint="blue">
            <Keyframes css={CSS} />
            <At x={20} y={20} w={440} h={262} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 18px 40px -18px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <At x={14} y={12} w={402} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <History size={13} color={primary()} />
                    <T size={12} weight={700}>
                        Ediciones masivas
                    </T>
                </At>
                <At x={14} y={32} w={402} style={{ display: 'flex' }}>
                    <T size={9} color={C.mutedFg}>
                        Lo que se cambió en lote en esta lista en los últimos 30 días.
                    </T>
                </At>
                <Entry y={54} what="Precio: subir 10 %" who="Laura Gómez" ini="LG" when="ayer" n="220 registros" last />
                <Entry y={114} what="Estado: poner «Vencida»" who="Automatización" ini="AU" when="hace 2 días" n="18 registros" />
                <Entry y={174} what="Desde «precios-proveedor.xlsx»" who="Juan Pérez" ini="JP" when="hace 6 días" n="250 registros" />

                {/* Diálogo */}
                <At x={0} y={0} w={440} h={262} a="ld-veil" style={{ opacity: 0, background: 'rgba(15,23,42,.3)' }} />
                <At x={60} y={46} w={320} a="ld-dlg" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 20px 44px -16px rgba(15,23,42,.6)' }}>
                    <T size={11} weight={700}>
                        Deshacer edición masiva
                    </T>
                    <span style={{ display: 'flex', gap: 6 }}>
                        {(
                            [
                                ['219', 'Vuelven atrás', 'mint'],
                                ['1', 'Cambiaron después', 'amber'],
                                ['0', 'Ya no existen', 'slate'],
                            ] as const
                        ).map(([n, l, t]) => (
                            <span key={l} style={{ flex: 1, borderRadius: 8, background: tone(t, 0.13), padding: '5px 8px', display: 'flex', flexDirection: 'column' }}>
                                <T size={13} weight={800} color={tone(t)}>
                                    {n}
                                </T>
                                <T size={8} weight={600} color={C.mutedFg}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </span>
                    <span style={{ borderRadius: 8, border: `1px solid ${tone('amber', 0.5)}`, background: tone('amber', 0.08), padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <T size={9} weight={600} style={{ whiteSpace: 'normal' }}>
                            Alguien volvió a tocar estos registros después de la edición
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, border: `1px solid ${C.border}`, background: C.card }} />
                            <T size={9}>Volverlos atrás igual</T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <Btn label="Cancelar" kind="outline" />
                        <Btn label="Deshacer" />
                    </span>
                </At>
            </At>
            <Cursor a="ld-cur" click="ld-ring" rest={[420, 270]} />
        </Stage>
    );
}
