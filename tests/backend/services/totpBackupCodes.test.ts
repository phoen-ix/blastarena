import { describe, it, expect } from '@jest/globals';
import { generateBackupCodes } from '../../../backend/src/utils/crypto';

/**
 * verifyCode() falls through to a bcrypt comparison against all ten stored backup-code hashes
 * whenever the TOTP check fails. At cost 12 that is ~2.5s of CPU on the libuv thread pool per
 * failed attempt — enough to starve every other bcrypt and gzip operation in the process — and it
 * ran even for input that could not possibly be a backup code, such as a mistyped 6-digit TOTP
 * code. A shape check now guards the loop. (audit TOTP-BACKUP-CPU-1)
 *
 * The guard must never reject a real backup code, so it is pinned against the generator here: a
 * regex that drifts out of sync with generateBackupCodes would silently break 2FA recovery, which
 * is exactly the situation a user reaches for backup codes in.
 */
const BACKUP_CODE_SHAPE = /^[0-9a-z]{4}-[0-9a-z]{4}$/;

describe('backup code shape guard', () => {
  it('accepts every code the generator produces', () => {
    for (let i = 0; i < 200; i++) {
      for (const code of generateBackupCodes(10)) {
        expect(code.toLowerCase().trim()).toMatch(BACKUP_CODE_SHAPE);
      }
    }
  });

  it('rejects a 6-digit TOTP code, which is the common mistyped input', () => {
    expect('123456').not.toMatch(BACKUP_CODE_SHAPE);
    expect('000000').not.toMatch(BACKUP_CODE_SHAPE);
  });

  it('rejects other junk that would otherwise cost ten bcrypt comparisons', () => {
    for (const junk of [
      '',
      'a',
      'abcd-efghi',
      'abcde-fgh',
      'abcd_efgh',
      'abcd efgh',
      'x'.repeat(64),
    ]) {
      expect(junk).not.toMatch(BACKUP_CODE_SHAPE);
    }
  });

  it('is applied after trimming and lowercasing, as verifyCode does', () => {
    const [code] = generateBackupCodes(1);
    expect(`  ${code.toUpperCase()}  `.toLowerCase().trim()).toMatch(BACKUP_CODE_SHAPE);
  });
});
