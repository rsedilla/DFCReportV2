'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PAGE_WIDTH } from '@/components/app-shell';
import { MyCellTabs } from '@/components/my-cell-tabs';
import { PersonPicker } from '@/components/person-picker';
import {
  membersReady,
  NO_MEMBERS,
  ThreeMembers,
  type ChosenMember,
} from '@/components/three-members';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  categoryLabel,
  CELL_CATEGORIES,
  CELL_DAYS,
  dayOfWeekLabel,
  requestNewCell,
  type CellCategory,
} from '@/lib/cells';
import { idempotencyKeyFor, useWriteKey } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * Ask for a new Cell (section 10), the tab beside My Cell (decision 0457). It was a dialog
 * over the list; a form this long is a page of its own on a phone, as installed apps make
 * one, and the phone's Back returns to My Cell.
 *
 * The leader is somebody the asker oversees, found by the person picker over their own
 * scope; the server refuses anybody else, the asker included, with its own message. Sent, it
 * returns to My Cell, where the request heads Your requests.
 */
export default function RequestNewCellPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [leader, setLeader] = useState<{ id: string; full_name: string } | null>(null);
  const [category, setCategory] = useState<CellCategory | ''>('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  // Three members besides the leader (decision 0353).
  const [members, setMembers] = useState<ChosenMember[]>([...NO_MEMBERS]);
  // Where the reader asked to go while the form held something, until they decide.
  const [leaving, setLeaving] = useState<string | null>(null);

  const [writeKey, renewWriteKey] = useWriteKey();
  const send = useMutation({
    mutationFn: () =>
      requestNewCell(
        {
          prospective_leader_id: leader?.id ?? '',
          category: category as CellCategory,
          day_of_week: Number(day),
          time_of_day: time,
          members: members.map((member) => member?.id ?? ''),
        },
        idempotencyKeyFor(
          'new-cell',
          writeKey,
          leader?.id ?? '',
          category,
          day,
          time,
          ...members.map((member) => member?.id ?? ''),
        ),
      ),
    onSuccess: async () => {
      renewWriteKey();
      await queryClient.invalidateQueries({ queryKey: ['sent-requests'] });
      router.push('/my-cell');
    },
  });

  const started =
    !send.isSuccess &&
    (leader !== null ||
      category !== '' ||
      day !== '' ||
      time !== '' ||
      members.some((member) => member !== null));

  // Closing the tab or reloading with something typed asks too, in the browser's own words.
  useEffect(() => {
    if (!started) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [started]);

  const ready =
    leader !== null &&
    category !== '' &&
    day !== '' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
    membersReady(members, leader.id);

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <MyCellTabs
        current="new"
        onLeave={(event, href) => {
          if (started) {
            event.preventDefault();
            setLeaving(href);
          }
        }}
      >
        <form
          className="mt-5 flex max-w-2xl flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) {
              send.mutate();
            }
          }}
        >
          <PersonPicker
            legend="Leader"
            description="Someone you oversee, not you."
            searchLabel={
              <>
                Search by name<span className="sr-only"> for the leader</span>
              </>
            }
            selectedId={leader?.id ?? null}
            selectedName={leader?.full_name ?? null}
            onSelect={(person) => {
              send.reset();
              setLeader(person);
            }}
          />

          <ThreeMembers
            leaderId={leader?.id ?? null}
            members={members}
            onChange={(next) => {
              send.reset();
              setMembers(next);
            }}
          />

          <RadioGroup
            legend="Category"
            columns={2}
            name="category"
            value={category}
            onChange={setCategory}
            options={CELL_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
          />

          <RadioGroup
            legend="Day"
            name="day_of_week"
            value={day}
            onChange={setDay}
            options={CELL_DAYS.map((value) => ({
              value: String(value),
              label: dayOfWeekLabel(value),
            }))}
          />

          <Field
            label="Time"
            description="Manila time, 24-hour."
            type="time"
            name="time_of_day"
            autoComplete="off"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />

          <FailureNotice failure={send.isError ? describeFailure(send.error) : null} />

          {/* No Cancel: the My Cell tab is the way out, and it asks first (decision 0457). */}
          <div>
            <Button type="submit" className="w-full sm:w-auto" disabled={!ready || send.isPending}>
              {send.isPending ? 'Sending…' : 'Send for approval'}
            </Button>
          </div>
        </form>
      </MyCellTabs>

      <Dialog
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title="Discard this request?"
      >
        <p className="text-sm leading-relaxed">What you have filled in is not sent.</p>
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:flex-wrap">
          <Button variant="secondary" data-autofocus onClick={() => setLeaving(null)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              const href = leaving;
              setLeaving(null);
              if (href !== null) {
                router.push(href);
              }
            }}
          >
            Discard
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
