import { describe, it, expect, jest, beforeEach } from '@jest/globals';

let callCount = 0;

jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => {
    callCount++;
    return `$2b$12$mocksalt${callCount}hashvalue${callCount}`;
  }),
  compare: jest.fn(async () => true),
}));

import bcrypt from 'bcrypt';
import {
  hashPassword,
  comparePassword,
  generateToken,
  hashToken,
  scrubEmailError,
} from '../../../backend/src/utils/crypto';

const mockHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;
const mockCompare = bcrypt.compare as jest.MockedFunction<typeof bcrypt.compare>;

describe('Crypto Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callCount = 0;
    mockHash.mockImplementation(async () => {
      callCount++;
      return `$2b$12$mocksalt${callCount}hashvalue${callCount}`;
    });
    mockCompare.mockImplementation(async () => true);
  });

  describe('hashPassword', () => {
    it('should return a bcrypt hash with $2b$ prefix', async () => {
      const hash = await hashPassword('testpassword');
      expect(hash).toMatch(/^\$2b\$/);
      expect(mockHash).toHaveBeenCalledWith('testpassword', 12);
    });

    it('should return different hashes for the same input due to salt', async () => {
      const hash1 = await hashPassword('samepassword');
      const hash2 = await hashPassword('samepassword');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('comparePassword', () => {
    it('should return true for a correct password', async () => {
      mockCompare.mockImplementation(async () => true);
      const result = await comparePassword('correcthorse', '$2b$12$somehash');
      expect(result).toBe(true);
      expect(mockCompare).toHaveBeenCalledWith('correcthorse', '$2b$12$somehash');
    });

    it('should return false for a wrong password', async () => {
      mockCompare.mockImplementation(async () => false);
      const result = await comparePassword('wrongpassword', '$2b$12$somehash');
      expect(result).toBe(false);
    });
  });

  describe('generateToken', () => {
    it('should return a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return unique values per call', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken', () => {
    it('should return a consistent hash for the same input', () => {
      const token = 'some-token-value';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
    });

    it('should return a different hash for different input', () => {
      const hash1 = hashToken('token-a');
      const hash2 = hashToken('token-b');
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('scrubEmailError', () => {
  /**
   * pino's default `err` serializer copies every enumerable own property of an Error. Nodemailer
   * attaches `response` (the raw SMTP line, which names the recipient), `rejected` and
   * `envelope.to` — so `logger.error({ err })` wrote addresses into the log even though no call
   * site passed one. This app hashes addresses with EMAIL_PEPPER specifically so it never keeps
   * them. (audit EMAIL-LOG-1)
   */
  function nodemailerError() {
    return Object.assign(new Error('Message failed: 550 5.1.1 <victim@example.com> User unknown'), {
      code: 'EENVELOPE',
      response: '550 5.1.1 <victim@example.com> User unknown',
      responseCode: 550,
      rejected: ['victim@example.com'],
      rejectedErrors: [{ recipient: 'victim@example.com' }],
      envelope: { from: 'noreply@blastarena.at', to: ['victim@example.com'] },
    });
  }

  it('drops every nodemailer field that carries an address', () => {
    const scrubbed = scrubEmailError(nodemailerError());
    const serialized = JSON.stringify(scrubbed);

    expect(serialized).not.toContain('victim@example.com');
    expect(serialized).not.toContain('rejected');
    expect(serialized).not.toContain('envelope');
    expect(serialized).not.toContain('response');
  });

  it('masks an address embedded in the message, keeping the diagnosis', () => {
    const scrubbed = scrubEmailError(nodemailerError());

    expect(scrubbed.message).toContain('550 5.1.1');
    expect(scrubbed.message).toContain('User unknown');
    expect(scrubbed.message).toContain('v***@e***.com');
    expect(scrubbed.message).not.toContain('victim@example.com');
  });

  it('keeps name and code, which are the useful parts', () => {
    const scrubbed = scrubEmailError(nodemailerError());
    expect(scrubbed.name).toBe('Error');
    expect(scrubbed.code).toBe('EENVELOPE');
  });

  it('caps the message so a huge SMTP response cannot flood the log', () => {
    const err = new Error('x'.repeat(10_000));
    expect(scrubEmailError(err).message.length).toBeLessThanOrEqual(300);
  });

  it('handles a non-Error without throwing', () => {
    expect(scrubEmailError('plain string with a@b.com').message).toContain('a***@b***.com');
    expect(scrubEmailError(undefined).message).toBe('undefined');
  });
});
