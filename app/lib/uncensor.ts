export const UNCENSORED_KEY = 'grok-studio-uncensor';
export const UNCENSORED_EVENT = 'grok-uncensor';

export function readUncensored(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(UNCENSORED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeUncensored(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (on) sessionStorage.setItem(UNCENSORED_KEY, '1');
    else sessionStorage.removeItem(UNCENSORED_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(UNCENSORED_EVENT));
}
