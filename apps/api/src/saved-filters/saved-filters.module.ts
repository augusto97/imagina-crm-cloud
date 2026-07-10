import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { SavedFiltersController } from './saved-filters.controller';
import { SavedFiltersRepository } from './saved-filters.repository';
import { SavedFiltersService } from './saved-filters.service';

@Module({
    imports: [AuthModule, ListsModule],
    controllers: [SavedFiltersController],
    providers: [SavedFiltersService, SavedFiltersRepository],
    exports: [SavedFiltersService],
})
export class SavedFiltersModule {}
