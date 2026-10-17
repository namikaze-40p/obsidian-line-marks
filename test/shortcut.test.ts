import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatShortcut, matchesShortcut, shortcutFromEvent } from '../src/shortcut.ts';

const keyEvent = (code: string, modifiers: { ctrl?: boolean, meta?: boolean, alt?: boolean, shift?: boolean } = {}) => ({
	code,
	ctrlKey: !!modifiers.ctrl,
	metaKey: !!modifiers.meta,
	altKey: !!modifiers.alt,
	shiftKey: !!modifiers.shift,
});

describe('matchesShortcut', () => {
	const shortcut = { modifiers: ['Ctrl' as const], code: 'KeyX' };

	test('true when the modifiers and the key match', () => {
		assert.equal(matchesShortcut(keyEvent('KeyX', { ctrl: true }), shortcut), true);
	});

	test('false when extra modifiers are pressed', () => {
		assert.equal(matchesShortcut(keyEvent('KeyX', { ctrl: true, shift: true }), shortcut), false);
	});

	test('false when modifiers are missing', () => {
		assert.equal(matchesShortcut(keyEvent('KeyX'), shortcut), false);
	});

	test('false when the key differs', () => {
		assert.equal(matchesShortcut(keyEvent('KeyC', { ctrl: true }), shortcut), false);
	});
});

describe('shortcutFromEvent', () => {
	test('records modifiers + key', () => {
		assert.deepEqual(shortcutFromEvent(keyEvent('KeyX', { alt: true, ctrl: true })), { modifiers: ['Ctrl', 'Alt'], code: 'KeyX' });
	});

	test('does not record while only modifiers are pressed', () => {
		assert.equal(shortcutFromEvent(keyEvent('ControlLeft', { ctrl: true })), null);
	});

	test('does not record without modifiers', () => {
		assert.equal(shortcutFromEvent(keyEvent('KeyX')), null);
	});

	test('does not record Shift alone as the modifier (cannot be told apart from typing)', () => {
		assert.equal(shortcutFromEvent(keyEvent('KeyX', { shift: true })), null);
	});
});

describe('formatShortcut', () => {
	test('notation on macOS', () => {
		assert.equal(formatShortcut({ modifiers: ['Shift', 'Meta'], code: 'Backspace' }, true), 'Cmd + Shift + Backspace');
	});

	test('notation on Windows / Linux', () => {
		assert.equal(formatShortcut({ modifiers: ['Alt'], code: 'KeyX' }, false), 'Alt + X');
	});

	test('digit keys', () => {
		assert.equal(formatShortcut({ modifiers: ['Ctrl'], code: 'Digit1' }, false), 'Ctrl + 1');
	});
});
