'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EquippingFrame, TermPicker } from '@/components/equipping-frame';
import { GradesPanel, phaseWords } from '@/components/final-grades';
import { Button } from '@/components/ui/button';
import { Dialog, DialogActions } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR } from '@/components/ui/frame';
import {
  currentTerm,
  getFinalGrades,
  listFinalGradeClasses,
  postClassGrades,
  termLabel,
  type ClassGrades,
  type Term,
} from '@/lib/equipping';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * **Final Grades** (SKILL.md section 29, decision 0501, point 16; decision 0508): a term's
 * classes, each saying where it stands, and the chosen class's grades. The Registrar posts a
 * class once it is checked, after a confirmation that says posting is final.
 */
export default function FinalGradesPage() {
  const [term, setTerm] = useState<Term>(() => currentTerm());
  const [chosen, setChosen] = useState<string | null>(null);
  const classes = useQuery({
    queryKey: ['equipping', 'final-grades', term],
    queryFn: ({ signal }) => listFinalGradeClasses(term, signal),
  });
  const list = classes.data?.data ?? [];
  const classId = (chosen !== null && list.some((c) => c.id === chosen) ? chosen : null) ?? list[0]?.id ?? null;

  return (
    <EquippingFrame
      current="/equipping/final-grades"
      title="Final Grades"
      lead="Post a class once its Coordinator has checked it."
    >
      <div className="flex flex-col gap-6">
        <div className={CONTROL_BAR}>
          <TermPicker term={term} onChange={setTerm} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Classes">
            {list.map((each) => (
              <Button
                key={each.id}
                type="button"
                variant={each.id === classId ? 'primary' : 'secondary'}
                aria-pressed={each.id === classId}
                className="py-1.5"
                onClick={() => setChosen(each.id)}
              >
                <span className="flex flex-col items-start leading-tight">
                  <span>{each.name}</span>
                  <span className="text-xs font-normal">{phaseWords(each.status)}</span>
                </span>
              </Button>
            ))}
          </div>
        </div>
        <FailureNotice failure={classes.isError ? describeFailure(classes.error) : null} />
        {classes.data && list.length === 0 ? (
          <p className="text-muted text-sm">No Life Class is open in {termLabel(term)}.</p>
        ) : null}
        {classId ? <ClassView key={classId} classId={classId} /> : null}
      </div>
    </EquippingFrame>
  );
}

function ClassView({ classId }: { classId: string }) {
  const read = useQuery({
    queryKey: ['equipping', 'final-grades', 'class', classId],
    queryFn: ({ signal }) => getFinalGrades(classId, signal),
  });
  if (read.isError) {
    return <FailureNotice failure={describeFailure(read.error)} />;
  }
  if (!read.data) {
    return <p className="text-muted text-sm">Loading…</p>;
  }
  return <GradesPanel data={read.data} coordinatorView={false} action={<PostButton data={read.data} />} />;
}

function PostButton({ data }: { data: ClassGrades }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [writeKey, renewWriteKey] = useWriteKey();
  const save = useMutation({
    mutationFn: () => postClassGrades(data.class.id, idempotencyKeyFor('equipping-post-grades', writeKey, data.class.id)),
    onSuccess: async () => {
      renewWriteKey();
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['equipping'] });
    },
  });
  const { phase, counts } = data.status;
  if (phase === 'POSTED') {
    return <p className="text-sm font-semibold">Posted. A change now is made by the Admin, with a reason.</p>;
  }
  return (
    <>
      {phase !== 'READY' ? (
        <p className="text-muted mb-2 text-sm">
          {phase === 'NOT_READY'
            ? 'Every lesson is recorded and the Coordinator checks the class before it can be posted.'
            : phase === 'WAITING_ADMIN'
              ? 'The Admin checks the Coordinator’s own disciples before it can be posted.'
              : 'The Coordinator checks the class before it can be posted.'}
        </p>
      ) : null}
      <Button type="button" className="w-auto" disabled={phase !== 'READY'} onClick={() => setConfirming(true)}>
        Post {data.class.name}…
      </Button>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Post ${data.class.name}?`}>
        <p className="text-sm">
          {counts.passed} passed · {counts.not_passed} not passed · {counts.not_yet} not yet.
        </p>
        <p className="text-muted mt-2 text-sm">
          Posting makes these grades final and ends the term for everyone but those still to attend the
          Encounter. A change after posting is made by the Admin, with a reason.
        </p>
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
        <DialogActions>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            Post grades
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
