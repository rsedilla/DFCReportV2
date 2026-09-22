'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PersonPicker } from '@/components/person-picker';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { SelectField } from '@/components/ui/select-field';
import { TextLink } from '@/components/ui/text-link';
import { categoryLabel, createCell, dayOfWeekLabel, type CellCategory } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

const CATEGORIES: readonly CellCategory[] = ['YOUTH', 'YOUNG_PRO', 'COUPLE'];
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * New Cell (SKILL.md sections 2 and 10): an administrator creates a Cell with its leader
 * while the initial encoding is open. The owner's design sends this to Cells without
 * drawing it (2026-09-22), so it follows Add a person.
 *
 * Whether this account may is the server's answer: the Cells list offers the link only to
 * a Whole Church holder of `cell.approve_leadership`, and the route decides (section 1,
 * principle 4).
 */
export default function NewCellPage() {
  return (
    <AppShell>
      <NewCellForm />
    </AppShell>
  );
}

function NewCellForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [leader, setLeader] = useState<{ id: string; full_name: string } | null>(null);
  const [category, setCategory] = useState<CellCategory | ''>('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createCell(
        {
          cell_leader_id: leader?.id ?? '',
          category: category as CellCategory,
          day_of_week: Number(day),
          time_of_day: time,
        },
        idempotencyKeyFor('new-cell', leader?.id ?? '', category, day, time),
      ),
    onSuccess: async (cell) => {
      await queryClient.invalidateQueries({ queryKey: ['cells'] });
      router.push(`/cells/${cell.id}/members`);
    },
  });

  const ready =
    leader !== null && category !== '' && day !== '' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <TextLink href="/cells" className="text-sm">
        ‹ Back to Cells
      </TextLink>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New Cell</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        For setting up the church&rsquo;s Cells. It gets a Cell ID when you create it, and its
        leader can then be given a Leader account from their record.
      </p>

      <form
        className="mt-8 flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            create.mutate();
          }
        }}
      >
        <FailureNotice failure={create.isError ? describeFailure(create.error) : null} />

        <PersonPicker
          legend="Cell leader"
          description="The person who will lead it. Its members must be in the same Network as them."
          searchLabel="Search for the leader by name"
          selectedId={leader?.id ?? null}
          selectedName={leader?.full_name ?? null}
          churchWide={false}
          onSelect={(person) => {
            create.reset();
            setLeader(person);
          }}
        />

        <RadioGroup
          legend="Category"
          name="category"
          required
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            label="Meets every"
            name="day_of_week"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          >
            <option value="">Choose a day</option>
            {DAYS.map((value) => (
              <option key={value} value={String(value)}>
                {dayOfWeekLabel(value)}
              </option>
            ))}
          </SelectField>

          <Field
            label="At"
            description="Manila time."
            type="time"
            name="time_of_day"
            autoComplete="off"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" disabled={!ready || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Cell'}
          </Button>
          <Link href="/cells" className={buttonClasses('secondary')}>
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
