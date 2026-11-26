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
    updateHelpdeskSettingsSchema,
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

    it('v0.1.469 — de dónde sale el horario del SLA: lo guardado sin el dato sigue con el propio; lo nuevo, el de la empresa', () => {
        // Guardado antes de v0.1.469 (sin `source`): sigue exactamente como antes.
        const old = readHelpdeskSettings({ helpdesk: { sla: { enabled: true, calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', holidays: 'co' } } } });
        expect(old.sla.calendar.source).toBe('own');
        expect(old.sla.calendar.end).toBe('18:00');
        // Un calendario guardado a medias tampoco pasa a la empresa por un valor por defecto.
        expect(readHelpdeskSettings({ helpdesk: { sla: { calendar: {} } } }).sla.calendar.source).toBe('own');
        // Una lista que nunca guardó la mesa de ayuda (o una política sin calendario): la empresa.
        expect(readHelpdeskSettings({}).sla.calendar.source).toBe('company');
        expect(readHelpdeskSettings({ helpdesk: { sla: { enabled: true } } }).sla.calendar.source).toBe('company');
        expect(readHelpdeskSettings({ helpdesk: 'roto' }).sla.calendar.source).toBe('company');
        // El elegido se respeta.
        expect(readHelpdeskSettings({ helpdesk: { sla: { calendar: { source: 'company', days: [1] } } } }).sla.calendar).toMatchObject({ source: 'company', days: [1] });
    });

    it('v0.1.469 — un PATCH sin `source` no le cambia el origen a la política (sin valores por defecto)', () => {
        const noCal = updateHelpdeskSettingsSchema.parse({ sla: { enabled: true } });
        expect(noCal.sla?.calendar).toBeUndefined();
        const partial = updateHelpdeskSettingsSchema.parse({ sla: { calendar: { end: '17:00' } } });
        expect(partial.sla?.calendar).toEqual({ end: '17:00' });
        expect(updateHelpdeskSettingsSchema.parse({ sla: { calendar: { source: 'company' } } }).sla?.calendar).toEqual({ source: 'company' });
        expect(updateHelpdeskSettingsSchema.safeParse({ sla: { calendar: { source: 'otro' } } }).success).toBe(false);
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
