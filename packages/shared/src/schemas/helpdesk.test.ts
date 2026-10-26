import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import {
    emailTriggerMatches,
    helpdeskMailboxInputSchema,
    isBlockedSender,
    messageIdList,
    normalizeMessageId,
    parseTicketTokens,
    readHelpdeskSettings,
    replySubject,
    slaTargetsFor,
    slaTriggerMatches,
    ticketToken,
} from './helpdesk';

describe('D2 — mesa de ayuda (puro)', () => {
    it('token del ticket y asunto de la respuesta (sin repetir Re: ni el token)', () => {
        expect(ticketToken('TCK-0007', 12)).toBe('TCK-0007');
        expect(ticketToken(null, 12)).toBe('#12');
        expect(replySubject('No puedo entrar', 'TCK-0007')).toBe('Re: No puedo entrar [TCK-0007]');
        expect(replySubject('RE: Re: No puedo entrar [TCK-0007]', 'TCK-0007')).toBe('Re: No puedo entrar [TCK-0007]');
        expect(replySubject('', '#3')).toBe('Re: Tu solicitud [#3]');
    });

    it('lee los tokens del asunto: [TCK-0001] y [#12], no [URGENTE]', () => {
        expect(parseTicketTokens('Re: Ayuda [TCK-0001]')).toEqual([{ kind: 'code', code: 'TCK-0001' }]);
        expect(parseTicketTokens('Fwd: [#12] factura')).toEqual([{ kind: 'id', id: 12 }]);
        expect(parseTicketTokens('[URGENTE] se cayó todo')).toEqual([]);
        expect(parseTicketTokens('[PED-2026-0042]')).toEqual([{ kind: 'code', code: 'PED-2026-0042' }]);
    });

    it('Message-ID: normaliza y lee listas de References', () => {
        expect(normalizeMessageId(' <ABC.123@Mail.Example.com> ')).toBe('abc.123@mail.example.com');
        expect(normalizeMessageId('con espacio@x')).toBeNull();
        expect(messageIdList('<a@x> <b@y>\r\n <a@x>')).toEqual(['a@x', 'b@y']);
        expect(messageIdList(['<a@x>', '<c@z>'])).toEqual(['a@x', 'c@z']);
        expect(messageIdList('sin-corchetes@x')).toEqual(['sin-corchetes@x']);
    });

    it('remitentes bloqueados: dirección exacta o dominio entero', () => {
        expect(isBlockedSender('Spam@Malo.com', ['@malo.com'])).toBe(true);
        expect(isBlockedSender('ana@bien.com', ['malo.com', 'otro@bien.com'])).toBe(false);
        expect(isBlockedSender('otro@bien.com', ['otro@bien.com'])).toBe(true);
        expect(isBlockedSender('x@malo.com', ['malo.com'])).toBe(true);
    });

    it('ajustes tolerantes y política por prioridad (con la de «todos» como respaldo)', () => {
        const s = readHelpdeskSettings({ helpdesk: { max_size_mb: 5, sla: { enabled: true } } });
        expect(s.max_size_mb).toBe(5);
        expect(s.max_per_sender_hour).toBe(20);
        expect(s.sla.calendar.days).toEqual([1, 2, 3, 4, 5]);
        expect(readHelpdeskSettings({ helpdesk: 'roto' }).sla.enabled).toBe(false);
        const policy = {
            priority_field_id: 9,
            targets: [
                { priority: 'alta', first_response_hours: 1, resolution_hours: 8 },
                { priority: null, first_response_hours: 8, resolution_hours: 40 },
            ],
        };
        expect(slaTargetsFor(policy, 'alta')?.first_response_hours).toBe(1);
        expect(slaTargetsFor(policy, 'baja')?.first_response_hours).toBe(8);
        expect(slaTargetsFor({ priority_field_id: null, targets: [] }, null)).toBeNull();
    });

    it('el buzón: el host va limpio y la dirección de soporte es un correo', () => {
        const ok = helpdeskMailboxInputSchema.safeParse({ host: 'imap.gmail.com', port: 993, security: 'tls', username: 'a@b.co', support_address: 'Soporte@B.co' });
        expect(ok.success && ok.data.support_address).toBe('soporte@b.co');
        expect(helpdeskMailboxInputSchema.safeParse({ host: 'imap://x', port: 993, security: 'tls', username: 'a', support_address: 'a@b.co' }).success).toBe(false);
    });

    it('disparadores: tipo de correo y alertas del SLA', () => {
        expect(emailTriggerMatches({}, { tipo: 'respuesta' })).toBe(true);
        expect(emailTriggerMatches({ email_kind: 'new' }, { tipo: 'respuesta' })).toBe(false);
        expect(emailTriggerMatches({ email_kind: 'reply' }, { tipo: 'respuesta' })).toBe(true);
        expect(slaTriggerMatches({}, { alerta: 'at_risk', objetivo: 'resolution' })).toBe(true);
        expect(slaTriggerMatches({ sla_alerts: ['breached'] }, { alerta: 'at_risk', objetivo: 'resolution' })).toBe(false);
        expect(slaTriggerMatches({ sla_targets: ['first_response'] }, { alerta: 'breached', objetivo: 'resolution' })).toBe(false);
    });

    it('«Responder por correo» en una automatización necesita el texto', () => {
        const issues = automationConfigIssues({ trigger_type: 'email_received', actions: [{ type: 'reply_email', config: { body: '  ' } }] });
        expect(issues.map((i) => i.path)).toContain('actions.0.config.body');
        expect(automationConfigIssues({ trigger_type: 'email_received', actions: [{ type: 'reply_email', config: { body: 'Hola' } }] })).toEqual([]);
    });
});
