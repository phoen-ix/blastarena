export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const ROOM_NAME_MIN_LENGTH = 3;
export const ROOM_NAME_MAX_LENGTH = 30;
export const ROOM_NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;

/**
 * i18n validation result: returns { key, params } for translation,
 * or null if valid. Use `translateValidation()` to get the translated string.
 */
interface ValidationError {
  key: string;
  params?: Record<string, string | number>;
}

export function validateUsername(username: string): string | null {
  const err = validateUsernameI18n(username);
  if (!err) return null;
  return defaultValidationMessage(err);
}

export function validatePassword(password: string): string | null {
  const err = validatePasswordI18n(password);
  if (!err) return null;
  return defaultValidationMessage(err);
}

export function validateRoomName(name: string): string | null {
  const err = validateRoomNameI18n(name);
  if (!err) return null;
  return defaultValidationMessage(err);
}

export function validateEmail(email: string): string | null {
  const err = validateEmailI18n(email);
  if (!err) return null;
  return defaultValidationMessage(err);
}

// --- i18n-aware variants (return key + params for translation) ---

export function validateUsernameI18n(username: string): ValidationError | null {
  if (username.length < USERNAME_MIN_LENGTH) {
    return { key: 'common:validation.usernameMinLength', params: { min: USERNAME_MIN_LENGTH } };
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return { key: 'common:validation.usernameMaxLength', params: { max: USERNAME_MAX_LENGTH } };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { key: 'common:validation.usernameInvalidChars' };
  }
  return null;
}

export function validatePasswordI18n(password: string): ValidationError | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { key: 'common:validation.passwordMinLength', params: { min: PASSWORD_MIN_LENGTH } };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { key: 'common:validation.passwordMaxLength', params: { max: PASSWORD_MAX_LENGTH } };
  }
  return null;
}

export function validateRoomNameI18n(name: string): ValidationError | null {
  if (name.length < ROOM_NAME_MIN_LENGTH) {
    return { key: 'common:validation.roomNameMinLength', params: { min: ROOM_NAME_MIN_LENGTH } };
  }
  if (name.length > ROOM_NAME_MAX_LENGTH) {
    return { key: 'common:validation.roomNameMaxLength', params: { max: ROOM_NAME_MAX_LENGTH } };
  }
  if (!ROOM_NAME_REGEX.test(name)) {
    return { key: 'common:validation.roomNameInvalidChars' };
  }
  return null;
}

export function validateEmailI18n(email: string): ValidationError | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { key: 'common:validation.emailInvalid' };
  }
  if (email.length > 255) {
    return { key: 'common:validation.emailMaxLength', params: { max: 255 } };
  }
  return null;
}

/**
 * Convert a ValidationError to its English fallback string.
 * Used by the original non-i18n validate* functions for backward compatibility.
 */
function defaultValidationMessage(err: ValidationError): string {
  const messages: Record<string, string> = {
    'common:validation.usernameMinLength': `Username must be at least ${USERNAME_MIN_LENGTH} characters`,
    'common:validation.usernameMaxLength': `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
    'common:validation.usernameInvalidChars':
      'Username can only contain letters, numbers, underscores, and hyphens',
    'common:validation.passwordMinLength': `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    'common:validation.passwordMaxLength': `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    'common:validation.emailInvalid': 'Invalid email address',
    'common:validation.emailMaxLength': 'Email must be at most 255 characters',
    'common:validation.roomNameMinLength': `Room name must be at least ${ROOM_NAME_MIN_LENGTH} characters`,
    'common:validation.roomNameMaxLength': `Room name must be at most ${ROOM_NAME_MAX_LENGTH} characters`,
    'common:validation.roomNameInvalidChars':
      'Room name can only contain letters, numbers, spaces, underscores, and hyphens',
  };
  return messages[err.key] || err.key;
}
