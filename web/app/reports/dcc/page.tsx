"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell, PAGE_WIDTH } from "@/components/app-shell";
import {
  AttendanceBuckets,
  ClassificationFigures,
} from "@/components/attendance-figures";
import { CoverageFigure } from "@/components/coverage-figure";
import { MonthPicker } from "@/components/month-picker";
import { FailureNotice } from "@/components/ui/failure-notice";
import { getMe, holdsWholeChurch } from "@/lib/me";
import { describeFailure } from "@/lib/messages";
import {
  getDccMonthlyReport,
  type ReportNetwork,
  type ReportScope,
} from "@/lib/reports";
import { dayLabel, reportingMonthOf } from "@/lib/reporting-month";

/**
 * DCC attendance figures for a month (SKILL.md sections 9, 12, 13, 17 and 20;
 * decisions 0216 and 0224).
 *
 * **Coverage here is obligations met over obligations owed** (decision 0224),
 * summed across the month's Sundays and never divided. It is a different figure
 * from the Cell one beside it: a Cell counts recorded meetings against scheduled
 * ones, and this counts leaders who filed against leaders who owed, which is why
 * the two carry different words.
 *
 * **A removed Sunday is named.** Section 9 requires a removal to be visible on any
 * report covering the month, "so that a month showing four events where the
 * calendar shows five is explained rather than merely odd". `N` on its own cannot
 * explain itself, so the dates are listed.
 *
 * **Buckets are shown here where a Cell report would not show them.** Section 12
 * puts the restriction on *Cell* buckets, because `N` belongs to a Cell; a DCC
 * event is church-wide, so one `N` covers everybody and an aggregate `Completed`
 * means the same thing for every person in it.
 *
 * **The open flag is load-bearing beside `N`** (section 17). `N` counts the calendar
 * rows the month holds whether or not their day has passed, so mid-month somebody
 * who came to both Sundays so far reads as two of three — and only the flag says
 * why.
 */
export default function DccReportPage() {
  return (
    <AppShell>
      <DccReport />
    </AppShell>
  );
}

export function DccReport() {
  const [month, setMonth] = useState(() => reportingMonthOf());

  // **Section 19's Senior Pastor scope selector.** Empty means the whole church; the
  // two Networks are the only other values section 4 defines. It is offered only to
  // a Whole Church holder, because that is the grant section 19 describes a Senior
  // Pastor by — a leader-scoped viewer has one scope and a control with one option
  // is a control that lies about having a choice.
  const [network, setNetwork] = useState<ReportNetwork | "">("");

  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => getMe(signal),
  });

  const wholeChurch = holdsWholeChurch(me.data, "reports.view_subtree");

  // A Whole Church grant is read as Whole Church, for the reason the Cell report
  // beside this one gives: an administrator holding one need not be in the
  // pastoral tree, and section 20 then places them in no subtree at all.
  //
  // **A Network narrows that grant and never widens a leader's**, which is why the
  // selector is gated above rather than the scope being chosen here: a leader-scoped
  // viewer reaches the `LEADER` branch whatever `network` holds.
  const scope: Exclude<ReportScope, { kind: "CELL" }> | null = wholeChurch
    ? network === ""
      ? { kind: "WHOLE_CHURCH" }
      : { kind: "NETWORK", network }
    : me.data
      ? { kind: "LEADER", person_id: me.data.person_id }
      : null;

  const report = useQuery({
    queryKey: ["dcc-report", month, scope],
    queryFn: ({ signal }) =>
      getDccMonthlyReport(
        month,
        scope as Exclude<ReportScope, { kind: "CELL" }>,
        signal,
      ),
    enabled: scope !== null,
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">DCC Figures</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        What the people you oversee recorded for this month&rsquo;s Sundays, and
        how many of the leaders who owed a record filed one.
      </p>

      <MonthPicker month={month} onChange={setMonth} open={report.data?.open} />

      {wholeChurch ? (
        <div className="mt-4">
          <label htmlFor="dcc-scope" className="block text-sm font-medium">
            Figures for
          </label>
          <select
            id="dcc-scope"
            value={network}
            onChange={(event) =>
              setNetwork(event.target.value as ReportNetwork | "")
            }
            className="border-line focus-visible:outline-accent mt-2 min-h-11 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">The whole church</option>
            <option value="MENS">Men&rsquo;s Network</option>
            <option value="WOMENS">Women&rsquo;s Network</option>
          </select>
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            A Network counts the people who belong to it, not the people under
            its root (decision 0219). The two Networks therefore add up to the
            whole church.
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        <FailureNotice
          failure={
            report.isError
              ? describeFailure(report.error)
              : me.isError
                ? describeFailure(me.error)
                : null
          }
        />
      </div>

      {report.isPending || scope === null ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : report.data ? (
        <div className="mt-8 flex flex-col gap-10">
          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="text-lg font-medium">
              Recording coverage
            </h2>
            <p className="mt-2">
              <CoverageFigure
                recorded={report.data.coverage.met}
                scheduled={report.data.coverage.owed}
                unit="records filed"
              />
            </p>
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Counted across every Sunday of the month. A leader owes one record
              for each Sunday they were responsible for somebody, and a Sunday
              that has not happened owes nobody anything.
            </p>
          </section>

          <section aria-labelledby="month-heading">
            <h2 id="month-heading" className="text-lg font-medium">
              The month
            </h2>
            <p className="mt-2 text-sm">
              <span className="text-xl font-semibold tabular-nums">
                {report.data.n}
              </span>
              <span className="text-muted">
                {" "}
                {report.data.n === 1 ? "Sunday counted" : "Sundays counted"}
              </span>
            </p>
            {report.data.removed_events.length > 0 ? (
              // Section 9: a removal records a decision, so it is named rather
              // than left as a smaller number nobody can explain.
              <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                No service was held on{" "}
                {report.data.removed_events
                  .map((date) => dayLabel(date))
                  .join(", ")}
                , so
                {report.data.removed_events.length === 1
                  ? " that Sunday is"
                  : " those Sundays are"}{" "}
                not counted.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="people-heading">
            <h2 id="people-heading" className="text-lg font-medium">
              People who attended
            </h2>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {report.data.unique_people}
            </p>
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Counted once each, however many Sundays they came to.
            </p>
          </section>

          <ClassificationFigures
            classification={report.data.classification}
            total={report.data.unique_people}
          />

          {report.data.n === 0 ? (
            <p className="text-muted max-w-2xl text-sm leading-relaxed">
              No Sundays were counted this month, so there is nothing to break
              down.
            </p>
          ) : (
            <AttendanceBuckets
              buckets={report.data.buckets}
              n={report.data.n}
            />
          )}
        </div>
      ) : null}
    </main>
  );
}
