import { CheckCircle2, List, RotateCcw, Trash2 } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/** La papelera: un registro eliminado va a la papelera con 30 días para recuperarlo, y «Restaurar» lo devuelve a su lista. */

const CLIENTS = ['Café La 14', 'Hotel Brisas', 'Óptica Visión', 'Colegio Andino', 'Clínica Norte'];
const RH = 30;
const LY = 8;

const CSS = `
@keyframes lpa-row{0%,13%{height:${RH}px;opacity:1;background:transparent}18%,62%{height:0;opacity:0;background:transparent}68%{height:${RH}px;opacity:1;background:${tone('mint', 0.22)}}80%,100%{height:${RH}px;opacity:1;background:transparent}}
@keyframes lpa-fly{0%,13%{opacity:0;transform:translate(0,0) scale(1)}15%{opacity:1;transform:translate(0,0) scale(1)}24%{opacity:1;transform:translate(214px,-10px) scale(.9)}26%,100%{opacity:0;transform:translate(214px,-10px) scale(.9)}}
@keyframes lpa-item{0%,24%{height:0;opacity:0}29%,58%{height:42px;opacity:1}64%,100%{height:0;opacity:0}}
@keyframes lpa-toast1{0%,24%{opacity:0;transform:translateY(8px)}28%,46%{opacity:1;transform:translateY(0)}50%,100%{opacity:0;transform:translateY(8px)}}
@keyframes lpa-toast2{0%,66%{opacity:0;transform:translateY(8px)}70%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes lpa-hover{0%,6%{opacity:0}9%,14%{opacity:1}16%,100%{opacity:0}}
@keyframes lpa-cur{0%{transform:translate(120px,290px);opacity:0}5%{opacity:1}10%,13%{transform:translate(196px,${46 + LY + RH + 15}px)}30%{transform:translate(300px,200px)}50%,58%{transform:translate(436px,98px);opacity:1}74%,90%{transform:translate(440px,240px);opacity:1}96%,100%{transform:translate(440px,240px);opacity:0}}
@keyframes lpa-ring{0%,10%{opacity:0;transform:scale(.4)}11%{opacity:1;transform:scale(1)}14%,55%{opacity:0;transform:scale(1.6)}56%{opacity:1;transform:scale(1)}59%,100%{opacity:0;transform:scale(1.6)}}
`;

export default function LotePapelera(): JSX.Element {
    return (
        <Stage label="Un cliente se elimina de la lista y aparece en la papelera con 30 días para recuperarlo; al tocar «Restaurar» vuelve a su lista tal cual." tint="rose">
            <Keyframes css={CSS} />
            {/* La lista */}
            <Win x={12} y={20} w={206} h={262} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><List size={10} />Clientes</span>}>
                <At x={8} y={LY} w={190} style={{ display: 'flex', flexDirection: 'column' }}>
                    {CLIENTS.map((c, i) => (
                        <div key={c} data-a={i === 1 ? '' : undefined} style={{ height: RH, overflow: 'hidden', borderRadius: 6, animationName: i === 1 ? 'lpa-row' : undefined }}>
                            <div style={{ height: RH, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', borderBottom: `1px solid ${C.border}` }}>
                                <T size={9.5} weight={600}>
                                    {c}
                                </T>
                                {i === 1 && (
                                    <span data-a="" style={{ display: 'flex', color: C.destructive, opacity: 0, animationName: 'lpa-hover' }}>
                                        <Trash2 size={11} />
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </At>
                <At x={8} y={196} w={190} a="lpa-toast1" style={{ opacity: 0, background: C.fg, borderRadius: 8, padding: '6px 9px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={8.5} weight={600} color={C.card}>
                        «Hotel Brisas» se movió a la papelera
                    </T>
                    <T size={8.5} weight={700} color={primary()}>
                        Deshacer
                    </T>
                </At>
                <At x={8} y={200} w={190} a="lpa-toast2" style={{ background: tone('mint', 0.16), borderRadius: 8, padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={12} color={tone('mint')} />
                    <T size={8.5} weight={600}>
                        Volvió con todo lo suyo
                    </T>
                </At>
            </Win>

            {/* Lo que vuela a la papelera */}
                <At x={28} y={46 + LY + RH + 4} a="lpa-fly" style={{ opacity: 0, zIndex: 9, background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 9px', boxShadow: '0 12px 22px -10px rgba(15,23,42,.55)' }}>
                    <T size={9.5} weight={600}>
                        Hotel Brisas
                    </T>
                </At>
            {/* La papelera */}
            <Win x={228} y={20} w={240} h={262} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trash2 size={10} />Ajustes · Papelera</span>}>
                <At x={10} y={8} w={220} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {['Todo', 'Registros', 'Listas', 'Campos'].map((f, i) => (
                        <span key={f} style={{ fontSize: 8.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, border: `1px solid ${i === 0 ? primary(0.6) : C.border}`, color: i === 0 ? primary() : C.mutedFg, background: i === 0 ? primary(0.1) : 'transparent' }}>
                            {f}
                        </span>
                    ))}
                </At>
                <At x={10} y={32} w={220} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div data-a="" style={{ height: 0, opacity: 0, overflow: 'hidden', animationName: 'lpa-item' }}>
                        <div style={{ height: 36, border: `1px solid ${tone('rose', 0.4)}`, borderRadius: 8, padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: tone('rose', 0.06) }}>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <T size={9.5} weight={700}>
                                    Hotel Brisas
                                </T>
                                <T size={8} color={C.mutedFg}>
                                    Registro · en «Clientes» · Quedan 30 días
                                </T>
                            </span>
                            <Btn label={<RotateCcw size={10} />} kind="outline" style={{ padding: '0 6px' }} />
                        </div>
                    </div>
                    {[
                        ['Proveedores 2025', 'Lista · con 120 registros', 'Quedan 12 días'],
                        ['Campo «Fax»', 'Campo · en «Clientes»', 'Quedan 21 días'],
                        ['Vista «Viejos»', 'Vista · en «Tareas»', 'Quedan 4 días'],
                    ].map(([n, d, q]) => (
                        <div key={n} style={{ height: 36, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <T size={9.5} weight={600}>
                                    {n}
                                </T>
                                <T size={8} color={C.mutedFg}>
                                    {d}
                                </T>
                            </span>
                            <Pill t="slate" label={q} />
                        </div>
                    ))}
                </At>
                <At x={10} y={212} w={220} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <RotateCcw size={10} color={C.mutedFg} />
                    <T size={8} color={C.mutedFg}>
                        Lo restaura quien lo borró o un admin
                    </T>
                </At>
            </Win>
            <Cursor a="lpa-cur" click="lpa-ring" rest={[440, 240]} />
        </Stage>
    );
}
