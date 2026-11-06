'use client';

import { useQuery } from '@tanstack/react-query';

import { PAGE_WIDTH } from '@/components/app-shell';
import { EncounterSeasonsFrame } from '@/components/encounter-seasons-frame';
import { GrowthTabs } from '@/components/growth-controls';
import { isBranchReader } from '@/components/reports-tabs';
import { TextLink } from '@/components/ui/text-link';
import { getMe } from '@/lib/me';
import { useOffered } from '@/lib/screen-guard';

/**
 * The Encounter seasons, to read (SKILL.md section 28, decision 0296), under Growth's Training
 * tab: the Encounter is a Training graduation, Life Class lesson 5. **An administrator sets
 * them on Admin's Settings tab** (decision 0425), the one place a church-wide setting is
 * changed; here every reader of SUYNL sees them, the administrator included.
 */
export default function Page() {
  return (
    <>
      <EncounterSeasons />
    </>
  );
}

function EncounterSeasons() {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  // SUYNL is the way back wherever Training is not on the account's screens: a Full view leader's
  // (decision 0360) and the recording screens' (decision 0379).
  const offered = useOffered();
  const branch = isBranchReader(me.data) || !offered('/growth/training');

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Growth</h1>
        <p className="text-muted text-sm">The Encounter God Weekends, set by an administrator.</p>
      </div>
      {/* A Full view leader's Training is hidden, so SUYNL is the way back (decision 0360). */}
      <GrowthTabs current={branch ? '/growth/suynl' : '/growth/training'}>
        <p className="mt-4">
          {branch ? (
            <TextLink href="/growth/suynl">Back to SUYNL</TextLink>
          ) : (
            <TextLink href="/growth/training">Back to Training</TextLink>
          )}
        </p>

        <EncounterSeasonsFrame editable={false} />
      </GrowthTabs>
    </main>
  );
}
