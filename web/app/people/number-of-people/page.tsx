'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The address *# of People* had under People (decision 0364). The figure is under Reports since
 * decision 0376; this forwards a saved link there with its month and leader, so nothing that
 * pointed here breaks. The query is read in the effect, on the client, so the page still
 * prerenders.
 */
export default function NumberOfPeopleMoved() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/reports/number-of-people${window.location.search}`);
  }, [router]);

  return null;
}
