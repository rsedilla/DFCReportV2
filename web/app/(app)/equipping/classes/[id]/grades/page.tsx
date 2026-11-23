'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';

import { EquippingFrame } from '@/components/equipping-frame';
import { GradesPanel } from '@/components/final-grades';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { TextLink } from '@/components/ui/text-link';
import { checkClassGrades, getCoordinatorGrades, type ClassGrades } from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * **A class's grades for its Coordinator** (decision 0501, point 16; decision 0508): read only,
 * the reader's own disciples marked as the Admin's to check, and *Mark as checked*.
 */
export default function CoordinatorGradesPage() {
  const { id } = useParams<{ id: string }>();
  const read = useQuery({
    queryKey: ['equipping', 'final-grades', 'coordinate', id],
    queryFn: ({ signal }) => getCoordinatorGrades(id, signal),
  });
  return (
    <EquippingFrame
      current="/equipping/classes"
      title="Classes"
      lead="Check each class’s grades before the Registrar posts them."
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          <TextLink href="/equipping/classes">Back to Classes</TextLink>
        </p>
        <FailureNotice failure={read.isError ? describeFailure(read.error) : null} />
        {read.data ? (
          <GradesPanel data={read.data} coordinatorView action={<CheckButton data={read.data} />} />
        ) : read.isError ? null : (
          <p className="text-muted text-sm">Loading…</p>
        )}
      </div>
    </EquippingFrame>
  );
}

function CheckButton({ data }: { data: ClassGrades }) {
  const queryClient = useQueryClient();
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () =>
      checkClassGrades(
        data.class.id,
        data.fingerprint,
        idempotencyKeyFor('equipping-check-grades', writeKey, data.class.id, data.fingerprint),
      ),
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  const { phase } = data.status;
  if (phase === 'POSTED') {
    return <p className="text-sm font-semibold">Posted by the Registrar.</p>;
  }
  const done = data.checks_as === 'ADMIN' ? phase === 'READY' && data.status.admin_check !== null : data.status.coordinator_check !== null;
  return (
    <>
      <p className="text-muted mb-2 text-sm">
        Read only. A wrong mark goes back to the Teacher, or the Admin once its week has closed; a change after
        a check needs checking again.
      </p>
      <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      {done ? (
        <p className="text-sm font-semibold" role="status">
          Checked. {phase === 'WAITING_ADMIN' ? 'The Admin checks your own disciples next.' : 'The Registrar can post it.'}
        </p>
      ) : (
        <Button type="button" className="w-auto" disabled={!data.may_check || save.isPending} onClick={() => save.mutate()}>
          Mark as checked
        </Button>
      )}
    </>
  );
}
