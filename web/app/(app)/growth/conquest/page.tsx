'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The address Conquest had under Growth. It is an item of the sidebar of its own since decision
 * 0407; this forwards a saved link there with its query, so nothing that pointed here breaks.
 * The query is read in the effect, on the client, so the page still prerenders.
 */
export default function ConquestMoved() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/conquest${window.location.search}`);
  }, [router]);

  return null;
}
