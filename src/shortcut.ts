// Keys are stored as `KeyboardEvent.code` (physical keys). `key` is not used, because on macOS Alt changes it to another character (Alt+X -> `≈`).
export type ShortcutModifier = 'Ctrl' | 'Meta' | 'Alt' | 'Shift';
export type Shortcut = { modifiers: ShortcutModifier[], code: string };

type KeyEventLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const MODIFIER_ORDER: ShortcutModifier[] = ['Ctrl', 'Meta', 'Alt', 'Shift'];

const MODIFIER_CODES = new Set([
	'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'CapsLock', 'Fn',
]);

const getModifiers = (event: KeyEventLike): ShortcutModifier[] => MODIFIER_ORDER.filter(modifier => ({
	Ctrl: event.ctrlKey,
	Meta: event.metaKey,
	Alt: event.altKey,
	Shift: event.shiftKey,
})[modifier]);

export const matchesShortcut = (event: KeyEventLike, shortcut: Shortcut): boolean => {
	const modifiers = getModifiers(event);
	return event.code === shortcut.code
		&& modifiers.length === shortcut.modifiers.length
		&& modifiers.every(modifier => shortcut.modifiers.includes(modifier));
};

// Creates a shortcut from the pressed keys. Returns null for modifiers alone, or without modifiers (it would block typing in the search input).
export const shortcutFromEvent = (event: KeyEventLike): Shortcut | null => {
	const modifiers = getModifiers(event);
	if (MODIFIER_CODES.has(event.code) || !modifiers.length || (modifiers.length === 1 && modifiers[0] === 'Shift')) {
		return null;
	}
	return { modifiers, code: event.code };
};

const formatCode = (code: string): string => {
	if (/^Key[A-Z]$/.test(code)) {
		return code.slice(3);
	}
	if (/^Digit\d$/.test(code)) {
		return code.slice(5);
	}
	return code;
};

export const formatShortcut = ({ modifiers, code }: Shortcut, isMacOS: boolean): string => {
	const names: Record<ShortcutModifier, string> = isMacOS
		? { Ctrl: 'Ctrl', Meta: 'Cmd', Alt: 'Option', Shift: 'Shift' }
		: { Ctrl: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' };
	return [...MODIFIER_ORDER.filter(modifier => modifiers.includes(modifier)).map(modifier => names[modifier]), formatCode(code)].join(' + ');
};
