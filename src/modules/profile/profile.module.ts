import { Module } from '@nestjs/common';
import { GetVillageCompleteness } from './application/get-village-completeness.use-case';
import { GetVillageProfile } from './application/get-village-profile.use-case';
import { ProfileController } from './web/profile.controller';

/**
 * Nest module of profile, imported only by AppModule. It owns no table: the
 * use cases read through the facades that village, curation, population,
 * heritage and economy export (their modules make them injectable app-wide).
 */
@Module({
  controllers: [ProfileController],
  providers: [GetVillageProfile, GetVillageCompleteness],
})
export class ProfileModule {}
