import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsStorableText } from '../../common/text/is-storable-text';
import { IsEmailAddress } from '../../common/text/is-email-address';

export class LoginDto {
  @IsEmailAddress({ message: 'Enter a valid email address.' })
  @MaxLength(320)
  email!: string;

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

/** A code from the app, or one recovery code: exactly one of the two. */
export class SecondStepDto extends SecondStepSetupDto {
  @ValidateIf((body: SecondStepDto) => body.recovery_code === undefined)
  @IsString()
  @MinLength(1, { message: 'Enter the code from your app.' })
  @MaxLength(32)
  code?: string;

  @ValidateIf((body: SecondStepDto) => body.code === undefined)
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
