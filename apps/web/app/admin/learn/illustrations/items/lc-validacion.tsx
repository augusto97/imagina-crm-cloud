import { AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';

import { At, Btn, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Validaciones de un campo: el NIT se revisa con su dígito de verificación
 * (un error se avisa con el mensaje propio y no deja guardar) y «Motivo de
 * pérdida» pasa a ser obligatorio sólo cuando el estado es «Perdido».
 */

const CSS = `
@keyframes vl-type{0%,6%{width:0}24%,100%{width:52px}}
@keyframes vl-d1{0%,24%{opacity:0}25%,46%{opacity:1}47%,100%{opacity:0}}
@keyframes vl-d8{0%,51%{opacity:0}52%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes vl-bd{0%,27%{border-color:${C.border}}29%,47%{border-color:${tone('rose')}}52%,94%{border-color:${tone('mint')}}98%,100%{border-color:${C.border}}}
@keyframes vl-err{0%,27%{opacity:0;transform:translateY(-3px)}30%,47%{opacity:1;transform:translateY(0)}50%,100%{opacity:0}}
@keyframes vl-ok{0%,52%{opacity:0;transform:scale(.5)}56%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes vl-st0{0%,62%{opacity:1}64%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes vl-st1{0%,62%{opacity:0}64%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes vl-mot{0%,64%{opacity:0;transform:translateY(-6px)}70%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes vl-test{0%,29%{background:transparent}31%,47%{background:${tone('rose', 0.12)}}52%,94%{background:${tone('mint', 0.12)}}98%,100%{background:transparent}}
@keyframes vl-tbad{0%,29%{opacity:0}31%,47%{opacity:1}50%,100%{opacity:0}}
@keyframes vl-tgood{0%,51%{opacity:0}53%,94%{opacity:1}98%,100%{opacity:0}}
`;

function Label({ children, req }: { children: string; req?: boolean }): JSX.Element {
    return (
        <span style={{ display: 'flex', gap: 2 }}>
            <T size={7.5} weight={600}>
                {children}
            </T>
            {req && (
                <T size={7.5} weight={700} color={tone('rose')}>
                    *
                </T>
            )}
        </span>
    );
}

const INPUT = { height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px', background: C.card } as const;

export default function LcValidacion(): JSX.Element {
    return (
        <Stage label="El campo NIT tiene la validación de NIT con dígito de verificación: al escribir un NIT con el dígito equivocado aparece el mensaje en rojo; al corregirlo queda en verde. Al elegir el estado Perdido, el Motivo de pérdida pasa a ser obligatorio." tint="mint">
            <Keyframes css={CSS} />
            {/* Reglas del campo */}
            <At x={12} y={20} w={194} h={260} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -22px rgba(15,23,42,.5)', padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('mint', 0.16), color: tone('mint'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ShieldCheck size={11} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={9.5} weight={700}>
                            NIT
                        </T>
                        <T size={7} color={C.mutedFg}>
                            Validaciones
                        </T>
                    </span>
                </span>
                <Label>Formato</Label>
                <span style={INPUT}>
                    <T size={8}>NIT con dígito de verificación</T>
                </span>
                <Label>Mensaje si no se cumple (opcional)</Label>
                <span style={{ ...INPUT, height: 34, alignItems: 'flex-start', paddingTop: 5 }}>
                    <T size={7.5} style={{ whiteSpace: 'normal' }}>
                        Revisa el NIT: el dígito de verificación no coincide.
                    </T>
                </span>
                <span style={{ height: 1, background: C.border, margin: '2px 0' }} />
                <Label>Prueba un valor</Label>
                <span data-a="" style={{ ...INPUT, justifyContent: 'space-between', animationName: 'vl-test' }}>
                    <span style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 80, height: '100%' }}>
                        <span data-a="" style={{ position: 'absolute', display: 'flex', animationName: 'vl-tbad', opacity: 0 }}>
                            <T size={8}>900.123.456-1</T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', display: 'flex', animationName: 'vl-tgood' }}>
                            <T size={8}>900.123.456-8</T>
                        </span>
                    </span>
                    <span style={{ position: 'relative', display: 'flex', width: 54, height: '100%', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <span data-a="" style={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', gap: 2, animationName: 'vl-tbad', opacity: 0 }}>
                            <AlertCircle size={9} color={tone('rose')} />
                            <T size={7} weight={700} color={tone('rose')}>
                                No cumple
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', gap: 2, animationName: 'vl-tgood' }}>
                            <CheckCircle2 size={9} color={tone('mint')} />
                            <T size={7} weight={700} color={tone('mint')}>
                                Cumple
                            </T>
                        </span>
                    </span>
                </span>
                <span style={{ height: 1, background: C.border, margin: '2px 0' }} />
                <Label>Obligatorio sólo si…</Label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <T size={7.5} color={C.mutedFg}>
                        «Motivo» si
                    </T>
                    <T size={7.5} weight={700}>
                        Estado
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        es
                    </T>
                    <Chip label="Perdido" t="rose" style={{ height: 14, fontSize: 7 }} />
                </span>
            </At>

            {/* Alta de registro */}
            <At x={218} y={20} w={250} h={260} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -20px rgba(15,23,42,.55)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <T size={11} weight={700}>
                    Nuevo registro
                </T>
                <T size={7.5} color={C.mutedFg}>
                    Clientes
                </T>
                <Label req>Nombre</Label>
                <span style={INPUT}>
                    <T size={8.5}>Café Bahía S.A.S.</T>
                </span>
                <Label req>NIT</Label>
                <span data-a="" style={{ ...INPUT, borderWidth: 1.5, justifyContent: 'space-between', animationName: 'vl-bd' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        <span data-a="" style={{ display: 'flex', overflow: 'hidden', width: 52, animationName: 'vl-type', animationTimingFunction: 'steps(12, end)' }}>
                            <T size={8.5}>900.123.456-</T>
                        </span>
                        <span style={{ position: 'relative', display: 'flex', width: 6, height: 12 }}>
                            <span data-a="" style={{ position: 'absolute', display: 'flex', animationName: 'vl-d1', opacity: 0 }}>
                                <T size={8.5}>1</T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', display: 'flex', animationName: 'vl-d8' }}>
                                <T size={8.5}>8</T>
                            </span>
                        </span>
                    </span>
                    <span data-a="" style={{ display: 'flex', animationName: 'vl-ok' }}>
                        <CheckCircle2 size={11} color={tone('mint')} />
                    </span>
                </span>
                <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 12, marginTop: -2, animationName: 'vl-err', opacity: 0 }}>
                    <AlertCircle size={9} color={tone('rose')} />
                    <T size={7.5} weight={600} color={tone('rose')}>
                        Revisa el NIT: el dígito de verificación no coincide.
                    </T>
                </span>
                <Label>Estado</Label>
                <span style={{ ...INPUT, position: 'relative' }}>
                    <span data-a="" style={{ position: 'absolute', left: 7, display: 'flex', animationName: 'vl-st0', opacity: 0 }}>
                        <Chip label="En curso" t="blue" style={{ height: 14, fontSize: 7.5 }} />
                    </span>
                    <span data-a="" style={{ position: 'absolute', left: 7, display: 'flex', animationName: 'vl-st1' }}>
                        <Chip label="Perdido" t="rose" style={{ height: 14, fontSize: 7.5 }} />
                    </span>
                </span>
                <span data-a="" style={{ display: 'flex', flexDirection: 'column', gap: 4, animationName: 'vl-mot' }}>
                    <Label req>Motivo de pérdida</Label>
                    <span style={{ ...INPUT, borderColor: primary(0.6) }}>
                        <T size={8} color={C.mutedFg}>
                            Eligió a otro proveedor
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
                    <Btn label="Crear" style={{ height: 20, fontSize: 8.5 }} />
                </span>
            </At>
        </Stage>
    );
}
