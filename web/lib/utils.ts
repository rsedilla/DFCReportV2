import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes so a caller's override wins over a component default.
 *
 * The vendored primitives take a `className` and have to let it beat their own
 * classes; plain concatenation leaves both in the attribute and lets source
 * order decide, which is invisible at the call site.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
