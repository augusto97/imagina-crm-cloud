import { Link2, Sigma, Search } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Relación entre listas: una factura nueva se vincula al cliente y, en la
 * lista de Clientes, los campos «Resumen de relación» (cantidad y saldo) y
 * «Buscar en relación» se actualizan solos.
 */

const CSS = `
@keyframes rl-row{0%,10%{opacity:0;transform:translateY(-8px)}16%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes rl-chip{0%,22%{opacity:0;transform:scale(.6)}28%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes rl-old{0%,40%{opacity:1}44%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes rl-new{0%,40%{opacity:0}44%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes rl-hl{0%,40%{background:transparent}46%,62%{background:${primary(0.13)}}72%,100%{background:transparent}}
@keyframes rl-tag{0%,50%{opacity:0;transform:translateY(4px)}56%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

function Cell({ w, children, right }: { w: number; children: JSX.Element; right?: boolean }): JSX.Element {
    return <span style={{ width: w, display: 'flex', alignItems: 'center', justifyContent: right ? 'flex-end' : 'flex-start', position: 'relative', height: '100%' }}>{children}</span>;
}

function Swap({ before, after, w, right }: { before: string; after: string; w: number; right?: boolean }): JSX.Element {
    const side = right ? { right: 0 } : { left: 0 };
    return (
        <Cell w={w} right={right}>
            <>
                <span data-a="" style={{ position: 'absolute', ...side, display: 'flex', animationName: 'rl-old', opacity: 0 }}>
                    <T size={8.5} weight={600}>
                        {before}
                    </T>
                </span>
                <span data-a="" style={{ position: 'absolute', ...side, display: 'flex', animationName: 'rl-new' }}>
                    <T size={8.5} weight={700} color={primary()}>
                        {after}
                    </T>
                </span>
            </>
        </Cell>
    );
}

function RelChip({ label }: { label: string }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 15, padding: '0 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.muted, fontSize: 7.5, fontWeight: 600, color: C.fg }}>
            <Link2 size={8} color={primary()} />
            {label}
        </span>
    );
}

const HEAD = { display: 'flex', alignItems: 'center', height: 22, padding: '0 10px', borderBottom: `1px solid ${C.border}` } as const;
const ROW = { display: 'flex', alignItems: 'center', height: 28, padding: '0 10px', borderBottom: `1px solid ${C.border}` } as const;

export default function LcRelacion(): JSX.Element {
    return (
        <Stage label="Una factura nueva se vincula al cliente Café Bahía; en la lista de Clientes, la cantidad de facturas pasa de 2 a 3 y el saldo pendiente sube solo, sin escribir nada a mano." tint="violet">
            <Keyframes css={CSS} />
            {/* Clientes */}
            <Win x={12} y={26} w={222} h={128} title="Clientes">
                <div style={HEAD}>
                    {[
                        ['Cliente', 88],
                        ['Facturas', 50],
                        ['Saldo pendiente', 64],
                    ].map(([l, w], i) => (
                        <span key={l} style={{ width: w as number, display: 'flex', justifyContent: i === 0 ? 'flex-start' : 'flex-end' }}>
                            <T size={7.5} weight={600} color={C.mutedFg}>
                                {l}
                            </T>
                        </span>
                    ))}
                </div>
                <div data-a="" style={{ ...ROW, animationName: 'rl-hl' }}>
                    <Cell w={88}>
                        <T size={8.5} weight={600}>
                            Café Bahía
                        </T>
                    </Cell>
                    <Swap w={50} before="2" after="3" right />
                    <Swap w={64} before="$ 900.000" after="$ 1.250.000" right />
                </div>
                {[
                    ['Clínica Norte', '4', '$ 0'],
                    ['Hotel Brisas', '1', '$ 480.000'],
                ].map(([n, c, s]) => (
                    <div key={n} style={ROW}>
                        <Cell w={88}>
                            <T size={8.5} weight={600}>
                                {n}
                            </T>
                        </Cell>
                        <Cell w={50} right>
                            <T size={8.5}>{c}</T>
                        </Cell>
                        <Cell w={64} right>
                            <T size={8.5}>{s}</T>
                        </Cell>
                    </div>
                ))}
            </Win>

            {/* Explicación de los campos */}
            <At x={12} y={166} w={222} h={108} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                    [<Link2 key="l" size={10} />, 'Relación', 'En cada factura eliges el cliente.', 'blue'],
                    [<Sigma key="s" size={10} />, 'Resumen de relación', 'Cuenta y suma sus facturas.', 'violet'],
                    [<Search key="b" size={10} />, 'Buscar en relación', 'Trae el email del cliente.', 'mint'],
                ].map(([ic, n, d, t], i) => (
                    <span
                        key={n as string}
                        data-a={i > 0 ? '' : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 8px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, animationName: i > 0 ? 'rl-tag' : undefined }}
                    >
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: tone(t as 'blue', 0.16), color: tone(t as 'blue'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{ic}</span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={8} weight={700}>
                                {n as string}
                            </T>
                            <T size={7} color={C.mutedFg}>
                                {d as string}
                            </T>
                        </span>
                    </span>
                ))}
            </At>

            {/* Facturas */}
            <Win x={246} y={26} w={222} h={248} title="Facturas">
                <div style={HEAD}>
                    {[
                        ['Factura', 54],
                        ['Cliente', 76],
                        ['Valor', 70],
                    ].map(([l, w], i) => (
                        <span key={l} style={{ width: w as number, display: 'flex', justifyContent: i === 2 ? 'flex-end' : 'flex-start' }}>
                            <T size={7.5} weight={600} color={C.mutedFg}>
                                {l}
                            </T>
                        </span>
                    ))}
                </div>
                <div data-a="" style={{ ...ROW, background: primary(0.06), animationName: 'rl-row' }}>
                    <Cell w={54}>
                        <T size={8.5} weight={700}>
                            FAC-0103
                        </T>
                    </Cell>
                    <Cell w={76}>
                        <span data-a="" style={{ display: 'flex', animationName: 'rl-chip' }}>
                            <RelChip label="Café Bahía" />
                        </span>
                    </Cell>
                    <Cell w={70} right>
                        <T size={8.5} weight={600}>
                            $ 350.000
                        </T>
                    </Cell>
                </div>
                {[
                    ['FAC-0102', 'Hotel Brisas', '$ 480.000'],
                    ['FAC-0101', 'Café Bahía', '$ 600.000'],
                    ['FAC-0100', 'Clínica Norte', '$ 220.000'],
                    ['FAC-0099', 'Café Bahía', '$ 300.000'],
                    ['FAC-0098', 'Clínica Norte', '$ 150.000'],
                ].map(([f, c, v]) => (
                    <div key={f} style={ROW}>
                        <Cell w={54}>
                            <T size={8.5} weight={600}>
                                {f}
                            </T>
                        </Cell>
                        <Cell w={76}>
                            <RelChip label={c!} />
                        </Cell>
                        <Cell w={70} right>
                            <T size={8.5}>{v}</T>
                        </Cell>
                    </div>
                ))}
                <span style={{ position: 'absolute', left: 10, bottom: 8, display: 'flex', gap: 4 }}>
                    <Chip label="Pendiente" t="amber" style={{ height: 14, fontSize: 7 }} />
                    <T size={7} color={C.mutedFg}>
                        se suma al saldo del cliente
                    </T>
                </span>
            </Win>
        </Stage>
    );
}
