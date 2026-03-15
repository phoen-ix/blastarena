export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const ROOM_NAME_MIN_LENGTH = 3;
export const ROOM_NAME_MAX_LENGTH = 30;
export const ROOM_NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;

export function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (!USERNAME_REGEX.test(username)) {
    return 'Username can only contain letters, numbers, underscores, and hyphens';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

export function validateRoomName(name: string): string | null {
  if (name.length < ROOM_NAME_MIN_LENGTH) {
    return `Room name must be at least ${ROOM_NAME_MIN_LENGTH} characters`;
  }
  if (name.length > ROOM_NAME_MAX_LENGTH) {
    return `Room name must be at most ${ROOM_NAME_MAX_LENGTH} characters`;
  }
  if (!ROOM_NAME_REGEX.test(name)) {
    return 'Room name can only contain letters, numbers, spaces, underscores, and hyphens';
  }
  return null;
}

export function validateEmail(email: string): string | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Invalid email address';
  }
  if (email.length > 255) {
    return 'Email must be at most 255 characters';
  }
  return null;
}

