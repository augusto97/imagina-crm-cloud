import { ArrowDown, Braces } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Variables: el mensaje se escribe una vez con {{campos}} y modificadores, y
 * cada envío sale con los datos de su registro, ya formateados.
 */

const STARTS = [10, 22, 34, 46, 58];

function css(): string {
    return STARTS.map(
        (s, i) => `@keyframes avr-t${i}{0%,${s - 1}%{background:${primary(0.12)};box-shadow:0 0 0 0 transparent}${s}%,${s + 8}%{background:${primary(0.22)};box-shadow:0 0 0 2px ${primary(0.45)}}${s + 11}%,100%{background:${primary(0.12)};box-shadow:0 0 0 0 transparent}}
@keyframes avr-v${i}{0%,${s + 3}%{opacity:0;background:transparent}${s + 6}%{opacity:1;background:${tone('amber', 0.35)}}${s + 16}%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes avr-m${i}{0%,${s - 1}%{background:transparent}${s}%,${s + 8}%{background:${primary(0.1)}}${s + 11}%,100%{background:transparent}}`,
    ).join('\n');
}

const tagStyle = { display: 'inline-block', padding: '0 4px', borderRadius: 4, color: primary(), fontWeight: 700, fontFamily: 'ui-monospace, monospace', fontSize: 8.6, lineHeight: '15px' } as const;
const Tag = ({ i, children }: { i: number; children: string }): JSX.Element => (
    <span data-a="" style={{ ...tagStyle, background: primary(0.12), animationName: `avr-t${i}` }}>
        {children}
    </span>
);
const Val = ({ i, children }: { i: number; children: string }): JSX.Element => (
    <span data-a="" style={{ fontWeight: 700, borderRadius: 3, padding: '0 1px', animationName: `avr-v${i}` }}>
        {children}
    </span>
);

const MODS: Array<[string, string]> = [
    ['{{cliente}}', 'el valor del campo'],
    ['|moneda', 'COP 1.250.000'],
    ['|larga', '26 de octubre de 2026'],
    ['|label', 'la etiqueta de la opción'],
    ['|pesos', 'el monto en letras'],
];

export default function AutoVariables(): JSX.Element {
    return (
        <Stage label="Las variables de una automatización: el mensaje se escribe una vez con campos entre llaves dobles y modificadores, y cada envío sale con los datos de su registro ya formateados." tint="violet">
            <Keyframes css={css()} />
            <Win x={14} y={16} w={452} h={104} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Braces size={10} /> Mensaje (lo escribes una vez)</span>}>
                <div style={{ position: 'absolute', left: 12, top: 10, right: 12, fontSize: 9.6, lineHeight: '19px', color: C.fg }}>
                    Hola <Tag i={0}>{'{{cliente}}'}</Tag>, tu factura <Tag i={1}>{'{{numero}}'}</Tag> por <Tag i={2}>{'{{monto|moneda}}'}</Tag> vence el <Tag i={3}>{'{{vencimiento|larga}}'}</Tag>. Estado: <Tag i={4}>{'{{estado|label}}'}</Tag>.
                </div>
            </Win>
            <At x={14} y={126} w={300} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <ArrowDown size={13} color={C.mutedFg} />
                <T size={8.4} color={C.mutedFg}>
                    con el registro FAC-1042
                </T>
            </At>
            <Win x={14} y={146} w={300} h={136} title="Lo que recibe Hotel Brisas">
                <div style={{ position: 'absolute', left: 12, top: 12, right: 12, fontSize: 9.6, lineHeight: '19px', color: C.fg }}>
                    Hola <Val i={0}>Hotel Brisas</Val>, tu factura <Val i={1}>FAC-1042</Val> por <Val i={2}>COP 1.250.000</Val> vence el <Val i={3}>26 de octubre de 2026</Val>. Estado: <Val i={4}>Pendiente de pago</Val>.
                </div>
            </Win>
            <Win x={326} y={146} w={140} h={136} title="Modificadores">
                {MODS.map(([m, v], i) => (
                    <At key={m} x={6} y={6 + i * 21} w={128} h={20} a={[`avr-m0`, `avr-m2`, `avr-m3`, `avr-m4`, undefined][i]} style={{ borderRadius: 5, padding: '0 5px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <T size={7.6} weight={700} color={primary()} style={{ fontFamily: 'ui-monospace, monospace' }}>
                            {m}
                        </T>
                        <T size={6.8} color={C.mutedFg}>
                            {v}
                        </T>
                    </At>
                ))}
            </Win>
        </Stage>
    );
}
