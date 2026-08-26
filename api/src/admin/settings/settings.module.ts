import { Module } from '@nestjs/common';

import { SettingsService } from './settings.service';

/**
 * `settings`, inside `admin` and separable from the rest of it.
 *
 * Section 2 gives `settings` to `admin`, and this is a sub-module of `admin`
 * rather than a tenth module — `src/admin/settings/`, exactly as
 * `AuthorizationModule` is `src/auth/authorization/`. The 2026-08-24 ruling
 * settled that section 2's "organise by module, never by layer" governs how the
 * *application* is divided and does not reach inside one module, and the boundary
 * it does enforce — table ownership — is unaffected: `settings` still belongs to
 * `admin`, and nothing outside `admin` touches it.
 *
 * **The seam exists because the alternative is an import cycle.**
 * `PeopleImportService` refuses unless the encoding phase is open,
 * and the tree import in `admin` calls `people`. Were the phase reader part of a
 * module that also carried the import, `people` would import `admin` and `admin`
 * would import `people`. That is the same shape, and the same remedy, as the
 * authorization seam splitting out of `AuthModule`: the thing `people` needs is a
 * question, not a module full of operations.
 *
 * It owns one table and imports nothing.
 */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
