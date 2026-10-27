import { ArrowRight, Building2, FilePlus2, Receipt } from 'lucide-react';

import { At, C, Chip, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Crear un registro» con mapeo: cuando el cliente llega a su fecha de cobro,
 * la automatización crea su factura en otra lista, con cada valor tomado del
 * cliente (y el período, del valor ANTERIOR de la fecha).
 */

const CSS = `
@keyframes acr-old{0%,14%{opacity:1}18%,95%{opacity:0}100%{opacity:1}}
@keyframes acr-new{0%,14%{opacity:0;transform:translateY(5px)}18%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes acr-hl{0%,12%{background:transparent}16%,26%{background:${primary(0.12)}}32%,100%{background:transparent}}
@keyframes acr-step{0%,24%{box-shadow:0 0 0 0 transparent}28%,82%{box-shadow:0 0 0 3px ${primary(0.25)}}88%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes acr-card{0%,30%{opacity:0;transform:translateX(-14px) scale(.96)}36%,92%{opacity:1;transform:translateX(0) scale(1)}97%,100%{opacity:0}}
`;

const MAP: Array<{ to: string; from: string; val: string; chip?: 'amber' }> = [
    { to: 'Cliente', from: '{{record.id}}', val: 'Hotel Brisas' },
    { to: 'Monto', from: '{{monto_mensual}}', val: '$ 850.000' },
    { to: 'Período', from: '{{before.proximo_cobro}}', val: '16/11/2026' },
    { to: 'Vence', from: '{{date.today|+15d}}', val: '01/12/2026' },
    { to: 'Estado', from: 'Pendiente', val: 'Pendiente', chip: 'amber' },
];

function mapCss(i: number): string {
    const s = 40 + i * 8;
    return `@keyframes acr-m${i}{0%,${s}%{background:transparent}${s + 2}%,${s + 7}%{background:${primary(0.13)}}${s + 10}%,100%{background:transparent}}
@keyframes acr-v${i}{0%,${s + 3}%{opacity:0;transform:translateX(-6px)}${s + 7}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}`;
}

export default function AutoCrearRegistro(): JSX.Element {
    return (
        <Stage label="La acción Crear un registro: cuando el cliente llega a su fecha de cobro, la automatización crea su factura en la lista Facturas, con el cliente, el monto, el período y el estado tomados del cliente." tint="blue">
            <Keyframes css={CSS + MAP.map((_, i) => mapCss(i)).join('\n')} />
            {/* El cliente */}
            <Win x={14} y={54} w={134} h={148} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building2 size={10} /> Clientes</span>}>
                <At x={10} y={8}>
                    <T size={10.5} weight={700}>
                        Hotel Brisas
                    </T>
                </At>
                {[
                    ['Monto mensual', '$ 850.000'],
                    ['Modalidad', 'Anticipado'],
                ].map(([k, v], i) => (
                    <At key={k} x={10} y={32 + i * 26} w={114} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={7.2} color={C.mutedFg}>
                            {k}
                        </T>
                        <T size={8.6} weight={600}>
                            {v}
                        </T>
                    </At>
                ))}
                <At x={4} y={84} w={126} h={32} a="acr-hl" style={{ borderRadius: 6, padding: '2px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={7.2} color={C.mutedFg}>
                        Próximo cobro
                    </T>
                    <span style={{ position: 'relative', display: 'block', height: 14 }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: 'acr-old' }}>
                            <T size={8.6} weight={600}>
                                16/11/2026
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 4, animationName: 'acr-new' }}>
                            <T size={8.6} weight={600}>
                                16/12/2026
                            </T>
                            <T size={7} weight={700} color={tone('blue')}>
                                rodó un mes
                            </T>
                        </span>
                    </span>
                </At>
            </Win>

            {/* La acción con su mapeo */}
            <At x={156} y={38} w={174} a="acr-step" style={{ borderRadius: 11, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -16px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 9px', borderBottom: `1px solid ${C.border}` }}>
                    <IconSquare t="blue" size={22}>
                        <FilePlus2 size={12} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Paso 1
                        </T>
                        <T size={8.6} weight={600}>
                            Crear un registro en «Facturas»
                        </T>
                    </span>
                </div>
                <div style={{ padding: '6px 6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', padding: '0 4px', gap: 4 }}>
                        <T size={6.8} weight={700} color={C.mutedFg} style={{ width: 46 }}>
                            CAMPO
                        </T>
                        <T size={6.8} weight={700} color={C.mutedFg}>
                            VALOR
                        </T>
                    </span>
                    {MAP.map((m, i) => (
                        <span key={m.to} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 21, padding: '0 4px', borderRadius: 5, border: `1px solid ${C.border}`, animationName: `acr-m${i}` }}>
                            <T size={7.8} weight={600} style={{ width: 46 }}>
                                {m.to}
                            </T>
                            <T size={7} weight={600} color={m.from.startsWith('{{') ? primary() : C.fg} style={{ fontFamily: m.from.startsWith('{{') ? 'ui-monospace, monospace' : undefined }}>
                                {m.from}
                            </T>
                        </span>
                    ))}
                </div>
            </At>
            <At x={334} y={136} style={{ color: C.mutedFg }}>
                <ArrowRight size={14} />
            </At>

            {/* La factura nueva */}
            <Win x={352} y={64} w={114} h={190} a="acr-card" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Receipt size={10} /> Facturas</span>}>
                <At x={9} y={8} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <T size={9.6} weight={700}>
                        FAC-1058
                    </T>
                    <span style={{ height: 13, padding: '0 5px', borderRadius: 99, background: tone('mint', 0.16), color: tone('mint'), fontSize: 6.8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Nueva</span>
                </At>
                {MAP.map((m, i) => (
                    <At key={m.to} x={9} y={30 + i * 26} w={98} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={6.8} color={C.mutedFg}>
                            {m.to}
                        </T>
                        <span data-a="" style={{ display: 'flex', animationName: `acr-v${i}` }}>
                            {m.chip ? (
                                <Chip label={m.val} t={m.chip} />
                            ) : (
                                <T size={8.4} weight={600}>
                                    {m.val}
                                </T>
                            )}
                        </span>
                    </At>
                ))}
            </Win>
            <At x={14} y={218} w={134} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <T size={7.6} weight={700} color={primary()}>
                    {'{{before.campo}}'}
                </T>
                <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    es el valor que tenía el campo antes del cambio: el período que se está cobrando.
                </T>
            </At>
        </Stage>
    );
}
