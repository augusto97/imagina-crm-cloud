import type { ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, DollarSign, ExternalLink, Eye, ListChecks, User, X } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Abrir un registro: un clic en el título abre la ficha y la tecla J pasa al siguiente sin cerrarla. */

type Rec = { n: string; c: string; m: string; v: string; s: string; t: 'rose' | 'amber' | 'mint' };
const RECS: Rec[] = [
    { n: 'FAC-0141', c: 'Hotel Brisas', m: '$ 3.600.000', v: '02/10/2026', s: 'Vencida', t: 'rose' },
    { n: 'FAC-0139', c: 'Colegio Andino', m: '$ 4.100.000', v: '09/10/2026', s: 'Vencida', t: 'rose' },
    { n: 'FAC-0137', c: 'Ferretería Sol', m: '$ 780.000', v: '14/10/2026', s: 'Vencida', t: 'rose' },
];
const RH = 30;

const CSS = `
@keyframes fa-modal{0%,13%{opacity:0;transform:translateY(12px) scale(.96)}19%,93%{opacity:1;transform:translateY(0) scale(1)}98%,100%{opacity:0}}
@keyframes fa-veil{0%,13%{opacity:0}19%,93%{opacity:1}98%,100%{opacity:0}}
@keyframes fa-r0{0%,40%{opacity:1}44%,100%{opacity:0}}
@keyframes fa-r1{0%,42%{opacity:0;transform:translateY(6px)}46%,64%{opacity:1;transform:translateY(0)}68%,100%{opacity:0}}
@keyframes fa-r2{0%,66%{opacity:0;transform:translateY(6px)}70%,100%{opacity:1;transform:translateY(0)}}
@keyframes fa-hl{0%,13%{transform:translateY(0);opacity:0}16%,42%{transform:translateY(0);opacity:1}46%,66%{transform:translateY(${RH}px);opacity:1}70%,93%{transform:translateY(${RH * 2}px);opacity:1}98%,100%{opacity:0}}
@keyframes fa-j1{0%,36%{opacity:0;transform:scale(.8)}40%,46%{opacity:1;transform:scale(1)}50%,100%{opacity:0}}
@keyframes fa-j2{0%,60%{opacity:0;transform:scale(.8)}64%,70%{opacity:1;transform:scale(1)}74%,100%{opacity:0}}
@keyframes fa-cur{0%{transform:translate(300px,290px);opacity:0}5%{opacity:1}10%,13%{transform:translate(60px,77px)}18%{opacity:1}24%,100%{transform:translate(60px,77px);opacity:0}}
@keyframes fa-ring{0%,10%{opacity:0;transform:scale(.4)}11%{opacity:1;transform:scale(1)}14%,100%{opacity:0;transform:scale(1.6)}}
`;

function Field({ icon, label, children }: { icon: JSX.Element; label: string; children: ReactNode }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', height: 26, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ width: 92, display: 'flex', alignItems: 'center', gap: 5, color: C.mutedFg }}>
                {icon}
                <T size={9} color={C.mutedFg}>
                    {label}
                </T>
            </span>
            {children}
        </div>
    );
}

function Content({ r, a, base }: { r: Rec; a: string; base: number }): JSX.Element {
    return (
        <At x={14} y={40} w={226} a={a} style={{ opacity: base, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 8, fontWeight: 600, color: C.mutedFg, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', alignSelf: 'flex-start' }}>Registro</span>
            <T size={15} weight={800}>
                {r.n}
            </T>
            <div>
                <Field icon={<User size={9} />} label="Cliente">
                    <T size={9.5} weight={600} color={primary()}>
                        {r.c}
                    </T>
                </Field>
                <Field icon={<DollarSign size={9} />} label="Monto">
                    <T size={9.5}>{r.m}</T>
                </Field>
                <Field icon={<CalendarDays size={9} />} label="Vencimiento">
                    <T size={9.5} color={tone('rose')}>
                        {r.v}
                    </T>
                </Field>
                <Field icon={<ListChecks size={9} />} label="Estado">
                    <Chip label={r.s} t={r.t} />
                </Field>
            </div>
        </At>
    );
}

export default function FichaAbrir(): JSX.Element {
    return (
        <Stage label="Una lista de facturas vencidas: un clic en el número abre la ficha encima de la lista, y la tecla J pasa a la factura siguiente sin cerrarla; detrás, la fila elegida va bajando." tint="blue">
            <Keyframes css={CSS} />
            {/* La tabla de fondo */}
            <At x={20} y={22} w={440} h={262} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <At x={10} y={8} w={420} h={20} style={{ display: 'flex', alignItems: 'center' }}>
                    <T size={10.5} weight={700}>
                        Facturas · Vencidas
                    </T>
                </At>
                <At x={10} y={40} w={420} h={RH} a="fa-hl" style={{ opacity: 0, background: primary(0.12), borderRadius: 6 }} />
                {[...RECS, { n: 'FAC-0133', c: 'Clínica Norte', m: '$ 2.200.000', v: '18/10/2026', s: 'Vencida', t: 'rose' as const }, { n: 'FAC-0129', c: 'Óptica Visión', m: '$ 950.000', v: '21/10/2026', s: 'Vencida', t: 'rose' as const }].map((r, i) => (
                    <At key={r.n} x={10} y={40 + i * RH} w={420} h={RH} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 90px 70px', alignItems: 'center', padding: '0 8px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={700}>
                            {r.n}
                        </T>
                        <T size={9.5}>{r.c}</T>
                        <T size={9.5}>{r.m}</T>
                        <span>
                            <Chip label={r.s} t={r.t} />
                        </span>
                    </At>
                ))}
            </At>
            <At x={20} y={22} w={440} h={262} a="fa-veil" style={{ background: 'rgba(15,23,42,.32)', borderRadius: 12 }} />

            {/* La ficha */}
            <At x={92} y={34} w={330} h={238} a="fa-modal" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 50px -18px rgba(15,23,42,.6)' }}>
                <At x={0} y={0} w={330} h={30} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}`, color: C.mutedFg }}>
                    <ChevronUp size={11} />
                    <span style={{ display: 'flex', borderRadius: 5, boxShadow: `0 0 0 1px ${primary(0.6)}`, color: primary() }}>
                        <ChevronDown size={11} />
                    </span>
                    <T size={9} color={C.mutedFg}>
                        Facturas /
                    </T>
                    <span style={{ flex: 1 }} />
                    <Eye size={11} />
                    <ExternalLink size={11} />
                    <X size={11} />
                </At>
                <Content r={RECS[0]!} a="fa-r0" base={0} />
                <Content r={RECS[1]!} a="fa-r1" base={0} />
                <Content r={RECS[2]!} a="fa-r2" base={1} />
                <At x={250} y={30} w={80} h={208} style={{ borderLeft: `1px solid ${C.border}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8} weight={700} color={C.mutedFg}>
                        COMENTARIOS
                    </T>
                    <span style={{ height: 6, width: 54, borderRadius: 99, background: C.muted }} />
                    <span style={{ height: 6, width: 40, borderRadius: 99, background: C.muted }} />
                    <span style={{ flex: 1 }} />
                    <span style={{ height: 30, borderRadius: 6, border: `1px solid ${C.border}` }} />
                </At>
            </At>

            {/* Teclas */}
            {(['fa-j1', 'fa-j2'] as const).map((a) => (
                <At key={a} x={26} y={196} a={a} style={{ opacity: 0, zIndex: 9, padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, borderBottomWidth: 3, background: C.card, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 10px 20px -10px rgba(15,23,42,.5)' }}>
                    <T size={20} weight={800}>
                        J
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        siguiente
                    </T>
                </At>
            ))}
            <Cursor a="fa-cur" click="fa-ring" rest={[60, 77]} />
        </Stage>
    );
}
