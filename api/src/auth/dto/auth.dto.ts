import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsStorableText } from '../../common/text/is-storable-text';
import { IsEmailAddress } from '../../common/text/is-email-address';

/** Sign-in takes the email address or the username, one or the other (decision 0337). */
export class LoginDto {
  @IsOptional()
  @IsEmailAddress({ message: 'Enter a valid email address.' })
  @MaxLength(320)
  email?: string;

  /**
   * Any text up to 100 characters: a name that cannot be a username is answered as a wrong
   * one is, so the shape of an answer says nothing about which names exist.
   */
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Enter your email address or username.' })
  @MaxLength(100)
  @IsStorableText()
  username?: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(512)
  password!: string;

  /**
   * Shown to the account holder in their own list of signed-in devices
   * (SKILL.md section 6). Optional, and never trusted for anything but display.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @IsStorableText()
  device_label?: string;

  /**
   * The proof a completed reset answered with, which this browser kept (decision 0413): for
   * fifteen minutes it signs in through a pause. Anything else is ignored.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @IsStorableText()
  reset_proof?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refresh_token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @IsStorableText()
  device_label?: string;
}

/** The ticket sign-in issued once the password was right (section 6, decision 0302). */
export class SecondStepSetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  challenge!: string;
}

export class SecondStepConfirmDto extends SecondStepSetupDto {
  @IsString()
  @MinLength(1, { message: 'Enter the code from your app.' })
  @MaxLength(32)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @IsStorableText()
  device_label?: string;
}

/** A code from the app, or one recovery code. The controller refuses both or neither. */
export class SecondStepDto extends SecondStepSetupDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Enter the code from your app.' })
  @MaxLength(32)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Enter a recovery code.' })
  @MaxLength(32)
  recovery_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @IsStorableText()
  device_label?: string;
}

export class LogoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refresh_token!: string;
}
