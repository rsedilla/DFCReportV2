import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsStorableText } from '../../common/text/is-storable-text';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
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

export class LogoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refresh_token!: string;
}
