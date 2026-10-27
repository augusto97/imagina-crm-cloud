import { ChevronDown, Lock, Plug } from 'lucide-react';

import { At, C, Flow, Keyframes, Pill, Stage, T, primary, tone } from '../kit';

/**
 * API personalizada: guardas UNA vez la dirección del servicio y su clave
 * (cifrada), le pones nombre a sus acciones («Emitir factura») con los datos
 * que pide, y la acción aparece en el editor de automatizaciones como un
 * formulario simple: quien arma la automatización ya no ve la parte técnica.
 */

const CSS = `
@keyframes ia-test{0%,22%{opacity:0;transform:scale(.7)}27%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ia-act{0%,30%{opacity:.3;box-shadow:0 0 0 0 transparent}36%{opacity:1;box-shadow:0 0 0 3px ${primary(0.3)}}44%,92%{opacity:1;box-shadow:0 0 0 0 transparent}97%,100%{opacity:.3}}
@keyframes ia-flow{0%,40%{opacity:0}46%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ia-form{0%,44%{opacity:0;transform:translateX(12px)}52%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes ia-v1{0%,56%{opacity:0}61%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ia-v2{0%,63%{opacity:0}68%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ia-sent{0%,74%{opacity:0;transform:translateY(5px)}80%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

function Row({ label, value, mono = false }: { label: string; value: JSX.Element | string; mono?: boolean }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <T size={8} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span
                style={{
                    height: 20,
                    borderRadius: 5,
                    border: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 7px',
                    fontSize: 9,
                    fontWeight: 500,
                    fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                }}
            >
                {value}
            </span>
        </span>
    );
}

export default function IntegApiCustom(): JSX.Element {
    return (
        <Stage label="Una API personalizada: guardas la dirección del servicio y su clave una sola vez, nombras una acción como Emitir factura con sus datos, y en las automatizaciones aparece como un formulario simple con variables del registro." tint="violet">
            <Keyframes css={CSS} />

            {/* La conexión (lo técnico, una sola vez) */}
            <At
                x={20}
                y={20}
                w={210}
                h={262}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 12, boxShadow: '0 14px 34px -18px rgba(15,23,42,.5)', display: 'flex', flexDirection: 'column', gap: 7 }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: '#64748b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Plug size={12} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10.5} weight={700}>
                            Mi facturación
                        </T>
                        <T size={8} color={C.mutedFg}>
                            API personalizada
                        </T>
                    </span>
                </span>
                <Row label="URL base" value="https://api.mifactura.co" mono />
                <Row label="Autenticación" value={<><span>Token Bearer</span><ChevronDown size={10} /></>} />
                <Row label="Clave / token" value={<><span style={{ letterSpacing: 1 }}>••••••••••</span><Lock size={9} color={C.mutedFg} /></>} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ height: 20, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 8.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                        Probar conexión
                    </span>
                    <span data-a="" style={{ animationName: 'ia-test' }}>
                        <Pill label="Conectó ✓" t="mint" />
                    </span>
                </span>
                <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 2 }}>
                    Acciones de esta conexión
                </T>
                <span
                    data-a=""
                    style={{ animationName: 'ia-act', display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: tone('violet', 0.07) }}
                >
                    <T size={9.5} weight={700}>
                        Emitir factura
                    </T>
                    <T size={8} color={C.mutedFg} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        POST /facturas · cliente · total
                    </T>
                </span>
            </At>

            <At x={0} y={0} a="ia-flow" style={{ opacity: 1 }}>
                <Flow x1={230} y1={236} x2={262} y2={110} />
            </At>

            {/* En el editor de automatizaciones: un formulario simple */}
            <At
                x={262}
                y={46}
                w={198}
                h={190}
                a="ia-form"
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 12, boxShadow: '0 14px 34px -18px rgba(15,23,42,.5)', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Entonces
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: '#64748b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Plug size={11} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10} weight={700}>
                            Emitir factura
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Mi facturación
                        </T>
                    </span>
                </span>
                <Row
                    label="Cliente *"
                    value={
                        <span data-a="" style={{ animationName: 'ia-v1' }}>
                            <Pill label="{{cliente}}" t="violet" />
                        </span>
                    }
                />
                <Row
                    label="Total *"
                    value={
                        <span data-a="" style={{ animationName: 'ia-v2' }}>
                            <Pill label="{{total}}" t="violet" />
                        </span>
                    }
                />
                <span data-a="" style={{ animationName: 'ia-sent', alignSelf: 'flex-start' }}>
                    <Pill label="Factura emitida ✓" t="mint" />
                </span>
            </At>
        </Stage>
    );
}
