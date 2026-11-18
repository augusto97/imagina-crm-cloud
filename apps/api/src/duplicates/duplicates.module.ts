import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { DuplicatesController } from './duplicates.controller';
import { DuplicatesService } from './duplicates.service';
import { RecordMergeService } from './record-merge.service';

/** A14 (v0.1.445, ADR-S106) — Duplicados: avisar al crear y fusionar. */
@Module({
    imports: [AuthModule, ListsModule, RecordsModule],
    controllers: [DuplicatesController],
    providers: [DuplicatesService, RecordMergeService],
    exports: [DuplicatesService],
})
export class DuplicatesModule {}
