import { describe, it, expect } from '@jest/globals';
import {
  validateUsername,
  validatePassword,
  validateEmail,
  EMAIL_RE,
} from '../../shared/src/utils/validation';

describe('Validation Utils', () => {
  describe('validateUsername', () => {
    it('should accept valid usernames', () => {
      expect(validateUsername('player1')).toBeNull();
      expect(validateUsername('test_user')).toBeNull();
      expect(validateUsername('pro-gamer')).toBeNull();
      expect(validateUsername('abc')).toBeNull();
    });

    it('should reject too short usernames', () => {
      expect(validateUsername('ab')).not.toBeNull();
      expect(validateUsername('')).not.toBeNull();
    });

    it('should reject too long usernames', () => {
      expect(validateUsername('a'.repeat(21))).not.toBeNull();
    });

    it('should reject invalid characters', () => {
      expect(validateUsername('user name')).not.toBeNull();
      expect(validateUsername('user@name')).not.toBeNull();
      expect(validateUsername('user.name')).not.toBeNull();
    });
  });

  describe('validatePassword', () => {
    it('should accept valid passwords', () => {
      expect(validatePassword('password123')).toBeNull();
      expect(validatePassword('abcdefgh')).toBeNull();
    });

    it('should reject too short passwords', () => {
      expect(validatePassword('1234567')).not.toBeNull();
    });

    it('should reject too long passwords', () => {
      expect(validatePassword('a'.repeat(129))).not.toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('test@example.com')).toBeNull();
      expect(validateEmail('user+tag@domain.co')).toBeNull();
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('notanemail')).not.toBeNull();
      expect(validateEmail('@domain.com')).not.toBeNull();
      expect(validateEmail('user@')).not.toBeNull();
      expect(validateEmail('user@domain..com')).not.toBeNull();
      expect(validateEmail('user@.domain.com')).not.toBeNull();
      expect(validateEmail('user@domain.com.')).not.toBeNull();
    });

    it('accepts multi-label domains', () => {
      expect(validateEmail('a.b@mail.sub.example.co.uk')).toBeNull();
    });

    it('rejects pathological input in linear time', () => {
      // The old pattern backtracked quadratically on `!@!.` + many `!.` (CodeQL js/polynomial-redos).
      // 40k repetitions take the old pattern ~8 s; the new one ~2 ms.
      const evil = '!@!.' + '!.'.repeat(40_000) + ' ';
      const start = Date.now();
      expect(EMAIL_RE.test(evil)).toBe(false);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(validateEmail(evil)).not.toBeNull();
    });
  });
});
