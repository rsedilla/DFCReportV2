import Image from 'next/image';
import type { ReactNode } from 'react';

import { TextLink } from '@/components/ui/text-link';
import { APPLICATION_FULL_NAME, APPLICATION_NAME, LOGO_PATH } from '@/lib/brand';

/**
 * The Privacy Notice (Data Privacy Act of 2012, RA 10173): what DREAMS keeps about a person,
 * why, who sees it, and how to reach the church's Data Protection Officer. Open to anyone,
 * signed in or not, and linked from the sign-in screen.
 *
 * Its wording is the owner's (decision 0412). A change to what DREAMS keeps, who sees it or
 * who helps run it makes this page wrong, so such a change updates it.
 */
export default function PrivacyNoticePage() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center gap-4">
        {/* Decorative: the name beside it says the same. */}
        <Image src={LOGO_PATH} alt="" width={56} height={56} unoptimized className="size-14 rounded-2xl" />
        <div>
          <p className="text-xl font-bold tracking-wide">{APPLICATION_NAME}</p>
          <p className="text-muted text-[0.8125rem]">{APPLICATION_FULL_NAME}</p>
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Privacy Notice</h1>
      <p className="mt-3 text-sm leading-relaxed">
        Doulos For Christ World Harvest Ministry uses DREAMS to care for its members and to see how
        its Cell Groups, DCC and discipleship are going. This notice explains what personal information DREAMS keeps about
        you, why we keep it, who can see it, and what you may ask of us. We handle it under the Data
        Privacy Act of 2012 (Republic Act No. 10173), as stewards of what you have entrusted to us.
      </p>

      <Part title="What we keep">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            About you: your name, and your title if you have one; your sex; your birthday, civil
            status and mobile number, where you gave them; and your Member ID.
          </li>
          <li>Your place in the church: your Network, your pastoral leader and your Cell Group.</li>
          <li>
            Your church life: your attendance at Cell Group meetings and at DCC, and your steps in
            SUYNL, Life Class, the Encounter and School of Leaders.
          </li>
          <li>
            If you lead and have an account: your email address or username, and a record of the
            changes you make.
          </li>
        </ul>
        <p className="mt-3">
          DREAMS does not keep photos, prayer requests, health information or home addresses.
        </p>
      </Part>

      <Part title="Why we keep it">
        <p>
          To care for you as a disciple: so that your leaders know whom to follow up, whom to pray
          for and who is ready for the next step. And to see, in totals, how the church as a whole
          is doing.
        </p>
        <p className="mt-3">
          We never sell your information, never use it for advertising, and never share it outside
          the church, except where the law requires us to.
        </p>
      </Part>

      <Part title="Children">
        <p>
          Some of our members are children. Their records are kept in the same way and seen by the
          same people, and we take particular care with them. A parent or guardian may ask about a
          child&rsquo;s record on the child&rsquo;s behalf.
        </p>
      </Part>

      <Part title="Who can see it">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            The leaders above you in the discipleship line, within your Network, and the leader of
            your Cell Group. Each leader sees only the people in their own branch, except that a
            leader adding someone new may be shown the name of a possible match elsewhere in the
            church, so that nobody is entered twice.
          </li>
          <li>The two Senior Pastors, and the church&rsquo;s system administrator.</li>
        </ul>
        <p className="mt-3">
          Every change to a record is kept, with who made it and when. Each time somebody opens or
          looks up a person&rsquo;s record, who and when is kept for one year, and the Admin can see
          it.
        </p>
      </Part>

      <Part title="How we protect it">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Only people with an account can sign in, and the administrator and the Senior Pastors
            use a second sign-in step.
          </li>
          <li>
            DREAMS is backed up every day, and the backups are encrypted, so whoever stores them
            cannot read them.
          </li>
          <li>
            Three service providers help run it: Hostinger, which hosts the server; Brevo, which
            sends the sign-in emails; and Google Drive, which stores the encrypted backups. They
            handle the information only to keep DREAMS running.
          </li>
          <li>
            If your information is ever exposed, we will tell you and the National Privacy
            Commission within 72 hours, as the law requires.
          </li>
        </ul>
      </Part>

      <Part title="How long we keep it">
        <p>
          For as long as you are part of the church&rsquo;s records. If you leave, your record is
          archived rather than deleted, so that past attendance totals stay true, and it is no
          longer counted among the church&rsquo;s current members. You may ask us to remove it
          altogether, and we will tell you what can be removed.
        </p>
      </Part>

      <Part title="Your rights">
        <p>
          Under the Data Privacy Act you may be told how your information is used, see it, have it
          corrected, object to its use, ask for it to be removed or blocked, and complain to the
          National Privacy Commission. The full list is on the{' '}
          <TextLink inline href="https://privacy.gov.ph/">
            National Privacy Commission&rsquo;s website
          </TextLink>
          .
        </p>
        <p className="mt-3">
          Most corrections are simplest through your Cell Group leader or your pastoral leader,
          who can update your record directly.
        </p>
      </Part>

      <Part title="Questions, and our Data Protection Officer">
        <p>
          If you have a question about this notice or about your information, or want to use any
          of the rights above, please contact our Data Protection Officer:
        </p>
        <p className="mt-3 font-medium">Doulos For Christ</p>
        <p>
          Our contact details are at{' '}
          <TextLink inline href="https://doulosforchrist.org">
            doulosforchrist.org
          </TextLink>
          .
        </p>
      </Part>

      <p className="text-muted mt-10 text-xs">Last updated: October 21, 2026</p>
      <p className="border-line mt-6 border-t pt-6 text-sm">
        <TextLink href="/sign-in">Back to sign in</TextLink>
      </p>
    </main>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
