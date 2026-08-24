import { Injectable, Logger } from '@nestjs/common';

import { type EmailPort, type OutboundEmail } from './email.port';

/**
 * The adapter that ships until a real provider is configured.
 *
 * It writes a line saying a message was produced, and **never the token**. A
 * token in a log is a credential in a log: logs are aggregated, retained longer
 * than the thirty minutes a reset token lives (section 6), and readable by people
 * who are not the account holder. Section 6's whole design is that only the
 * holder's inbox ever sees it, and logging it would undo that more quietly than
 * any of the paths that section guards.
 *
 * **It is not a silent no-op either.** An operator who has not configured a
 * provider needs to see that mail is being dropped rather than delivered, or the
 * first sign is a leader who never received an activation email and has no way to
 * say so.
 *
 * A real provider — SES or otherwise — implements `EmailPort` beside this file and
 * is swapped in `EmailModule`. Nothing outside `src/email` changes when it is,
 * which is what section 2 requires of this boundary.
 */
@Injectable()
export class LoggingEmailAdapter implements EmailPort {
  private readonly logger = new Logger(LoggingEmailAdapter.name);

  send(message: OutboundEmail): Promise<void> {
    this.logger.warn(
      `No email provider is configured, so this ${message.kind} message was not delivered. ` +
        `Recipient: ${message.to.email}. The token is deliberately not logged.`,
    );

    return Promise.resolve();
  }
}
