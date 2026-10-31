import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { RecordsModule } from '../records/records.module';
import { ListSuggestionsAiService } from './list-suggestions-ai.service';
import { ListSuggestionsController } from './list-suggestions.controller';
import { ListSuggestionsService } from './list-suggestions.service';
import { ListSuggestionsStore } from './list-suggestions.store';

/**
 * v0.1.341 (ADR-S89) — Sugerencias por lista: reglas gratis + IA a pedido.
 * El asistente (AiModule: clave, registro de herramientas, propuestas) y la
 * bitácora son globales.
 */
@Module({
    imports: [AuthModule, RecordsModule, FieldsModule],
    controllers: [ListSuggestionsController],
    providers: [ListSuggestionsStore, ListSuggestionsService, ListSuggestionsAiService],
    exports: [ListSuggestionsService],
})
export class ListSuggestionsModule {}
