import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Lock, X } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/** Dependencias: «Instalar el piso» está bloqueado por «Secado del cemento»; al intentar terminarlo, la app pide confirmar. */

const CSS = `
@keyframes fdp-menu{0%,16%{opacity:0;transform:translateY(-4px)}20%,36%{opacity:1;transform:translateY(0)}39%,100%{opacity:0}}
@keyframes fdp-hl{0%,26%{opacity:0}29%,37%{opacity:1}39%,100%{opacity:0}}
@keyframes fdp-veil{0%,38%{opacity:0}42%,93%{opacity:1}98%,100%{opacity:0}}
@keyframes fdp-dlg{0%,38%{opacity:0;transform:translateY(10px) scale(.96)}43%,93%{opacity:1;transform:translateY(0) scale(1)}98%,100%{opacity:0}}
@keyframes fdp-cur{0%{transform:translate(140px,290px);opacity:0}5%{opacity:1}12%,16%{transform:translate(112px,95px)}28%,34%{transform:translate(120px,170px)}48%,92%{transform:translate(264px,188px);opacity:1}97%,100%{opacity:0}}
@keyframes fdp-ring{0%,14%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}18%,32%{opacity:0;transform:scale(1.6)}33%{opacity:1;transform:scale(1)}36%,100%{opacity:0;transform:scale(1.6)}}
`;

function Dep({ dir, label, state, t }: { dir: 'in' | 'out'; label: string; state: string; t: 'amber' | 'slate' }): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', border: `1px solid ${C.border}`, borderRadius: 7 }}>
            {dir === 'in' ? <ArrowDownRight size={10} color={tone('amber')} /> : <ArrowUpRight size={10} color={C.mutedFg} />}
            <T size={9.5} weight={600} style={{ flex: 1 }}>
                {label}
            </T>
            <Pill label={state} t={t} />
            <X size={9} color={C.mutedFg} />
        </span>
    );
}

export default function FichaDependencias(): JSX.Element {
    return (
        <Stage label="En la ficha de la tarea «Instalar el piso», la sección Dependencias dice que está bloqueada por «Secado del cemento», que sigue abierto. Al cambiar el estado a Terminado aparece el aviso «Todavía está bloqueado» con los botones Cancelar y Cerrar igual." tint="amber">
            <Keyframes css={CSS} />
            <Win x={20} y={18} w={300} h={264} title="Obra Calle 80 / Instalar el piso">
                <At x={12} y={10} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={12} color={tone('amber')} />
                    <T size={13} weight={800}>
                        Instalar el piso
                    </T>
                </At>
                <At x={12} y={38} w={276} h={26} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
                    <T size={9} color={C.mutedFg} style={{ width: 66 }}>
                        Estado
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Chip label="En curso" t="blue" />
                        <ChevronDown size={9} color={C.mutedFg} />
                    </span>
                </At>
                <At x={12} y={64} w={276} h={26} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
                    <T size={9} color={C.mutedFg} style={{ width: 66 }}>
                        Entrega
                    </T>
                    <T size={9.5}>05/11/2026</T>
                </At>
                <At x={12} y={100} w={276} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={10} weight={700}>
                        Dependencias
                    </T>
                    <T size={8.5} weight={600} color={C.mutedFg}>
                        Bloqueado por
                    </T>
                    <Dep dir="in" label="Secado del cemento" state="Abierto" t="amber" />
                    <T size={8.5} weight={600} color={C.mutedFg} style={{ marginTop: 4 }}>
                        Bloquea a
                    </T>
                    <Dep dir="out" label="Pintar los zócalos" state="Abierto" t="slate" />
                </At>

                {/* Opciones del estado */}
                <At x={74} y={62} w={130} a="fdp-menu" style={{ opacity: 0, zIndex: 5, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: 5, boxShadow: '0 14px 30px -12px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {(
                        [
                            ['Pendiente', 'slate'],
                            ['En curso', 'blue'],
                            ['Terminado', 'mint'],
                        ] as const
                    ).map(([l, t], i) => (
                        <span key={l} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 22, padding: '0 6px', borderRadius: 6 }}>
                            {i === 2 && <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 6, background: primary(0.12), animationName: 'fdp-hl' }} />}
                            <span style={{ position: 'relative', display: 'flex' }}>
                                <Chip label={l} t={t} />
                            </span>
                        </span>
                    ))}
                </At>
            </Win>

            {/* El aviso */}
            <At x={0} y={0} w={480} h={300} a="fdp-veil" style={{ background: 'rgba(15,23,42,.35)', zIndex: 8 }} />
            <At x={150} y={92} w={230} a="fdp-dlg" style={{ zIndex: 9, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, boxShadow: '0 24px 50px -16px rgba(15,23,42,.6)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 99, background: tone('amber', 0.18), color: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AlertTriangle size={12} />
                    </span>
                    <T size={11} weight={700}>
                        Todavía está bloqueado
                    </T>
                </span>
                <T size={9} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                    Todavía está bloqueado por «Secado del cemento». ¿Cerrar igual?
                </T>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
                    <Btn label="Cancelar" kind="outline" />
                    <Btn label="Cerrar igual" />
                </span>
            </At>
            <Cursor a="fdp-cur" click="fdp-ring" rest={[264, 188]} />
        </Stage>
    );
}
