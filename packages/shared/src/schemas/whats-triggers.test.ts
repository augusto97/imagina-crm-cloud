import { describe, expect, it } from 'vitest';
import {
    WHATS_EVENT_KINDS,
    WHATS_EVENT_MERGE_TAGS,
    WHATS_TRIGGER_EVENT_NAMES,
    describeWhatsTrigger,
    readWhatsTriggerConfig,
    whatsTriggerEvents,
    whatsTriggerMatches,
} from './whats-triggers';
import { waWebHookEventsFor } from './whatsapp';

describe('whats-triggers', () => {
    it('sin un evento válido no hay config', () => {
        expect(readWhatsTriggerConfig({})).toBeNull();
        expect(readWhatsTriggerConfig({ whats_event: 'appointment' })).toBeNull();
        expect(readWhatsTriggerConfig(null)).toBeNull();
    });

    it('lee con valores por defecto tolerantes', () => {
        const status = readWhatsTriggerConfig({ whats_event: 'message_status', statuses: ['nope'], connection_id: '7' })!;
        expect(status.sub).toEqual(['failed']);
        expect(status.connectionId).toBe(7);
        expect(status.ifMissing).toBe('skip');
        const created = readWhatsTriggerConfig({ whats_event: 'contact_created', phone_field_id: 12 })!;
        expect(created.ifMissing).toBe('create');
        expect(created.phoneFieldId).toBe(12);
        expect(readWhatsTriggerConfig({ whats_event: 'form', if_missing: 'skip' })!.ifMissing).toBe('skip');
        expect(readWhatsTriggerConfig({ whats_event: 'conversation' })!.sub).toEqual(['created', 'assigned', 'resolved']);
    });

    it('traduce a eventos de Whats y coincide por conexión', () => {
        const cfg = readWhatsTriggerConfig({ whats_event: 'message_status', statuses: ['read', 'failed', 'read'] })!;
        expect(whatsTriggerEvents(cfg)).toEqual(['wa.message.read', 'wa.message.failed']);
        expect(whatsTriggerMatches(cfg, 'wa.message.read', 3)).toBe(true);
        expect(whatsTriggerMatches(cfg, 'wa.message.sent', 3)).toBe(false);
        const only = readWhatsTriggerConfig({ whats_event: 'contact_created', connection_id: 5 })!;
        expect(whatsTriggerMatches(only, 'contact.created', 5)).toBe(true);
        expect(whatsTriggerMatches(only, 'contact.created', 6)).toBe(false);
    });

    it('cada evento tiene su nombre, sin citas ni pagos', () => {
        expect(WHATS_EVENT_KINDS.length).toBe(7);
        expect(WHATS_TRIGGER_EVENT_NAMES).toContain('csat.received');
        expect(WHATS_TRIGGER_EVENT_NAMES.some((e) => e.startsWith('appointment') || e.startsWith('payment'))).toBe(false);
        expect(new Set(WHATS_EVENT_MERGE_TAGS.map((t) => t.tag)).size).toBe(WHATS_EVENT_MERGE_TAGS.length);
    });

    it('resume en lenguaje humano', () => {
        expect(describeWhatsTrigger(readWhatsTriggerConfig({ whats_event: 'message_status', statuses: ['failed', 'canceled'] })!)).toBe(
            'Cuando un mensaje de Whats falla o se cancela',
        );
        expect(describeWhatsTrigger(readWhatsTriggerConfig({ whats_event: 'conversation', conversation_events: ['resolved'] })!)).toBe(
            'Cuando una conversación de Whats se resuelve',
        );
        expect(describeWhatsTrigger(readWhatsTriggerConfig({ whats_event: 'contact_created' })!)).toBe('Cuando se crea un contacto en Whats');
    });

    it('los avisos que piden los disparadores se suman sin repetirse', () => {
        const out = waWebHookEventsFor({ inbound: false, statuses: false, extra: ['contact.created', 'wa.message.failed', 'wa.message.read'] });
        expect(out).toEqual(['wa.message.failed', 'wa.message.canceled', 'contact.created', 'wa.message.read']);
    });
});
