import { Injectable } from '@nestjs/common';

import { type EmailPort, type OutboundEmail } from '../../src/email/email.port';

/**
 * The email adapter the tests run against.
 *
 * **It exists because there is no other way to obtain a token.** SKILL.md section 6
 * keeps activation and reset tokens out of every API response — an administrator
 * may not know or choose another user's password, and a token that sets one is the
 * same secret a step earlier — so a test that wants to complete an activation has
 * to read the message, exactly as the holder would.
 *
 * That is a property worth having rather than a workaround: a test that could get
 * the token from the provisioning response would be passing against an API that
 * violated section 6.
 */
@Injectable()
export class CapturingEmailAdapter implements EmailPort {
  readonly sent: OutboundEmail[] = [];

  /** Set to make the next send throw, for the delivery-failure cases. */
  failNext = false;

  send(message: OutboundEmail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('The email provider is unavailable.'));
    }

    this.sent.push(message);
    return Promise.resolve();
  }

  /** The most recent message of a kind, or undefined. */
  last<K extends OutboundEmail['kind']>(kind: K): Extract<OutboundEmail, { kind: K }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const message = this.sent[i];
      if (message.kind === kind) {
        return message as Extract<OutboundEmail, { kind: K }>;
      }
    }

    return undefined;
  }

  reset(): void {
    this.sent.length = 0;
    this.failNext = false;
  }
}
