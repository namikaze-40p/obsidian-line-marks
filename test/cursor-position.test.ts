import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findCursorCh } from '../src/cursor-position.ts';

const textStart = (text: string, isCode = false) => findCursorCh(text, 'textStart', isCode ? 'code' : 'other');

describe('findCursorCh', () => {
	test('lineStart is always 0', () => {
		assert.equal(findCursorCh('  - [ ] foo', 'lineStart', 'other'), 0);
	});

	test('lineEnd is the length of the line', () => {
		assert.equal(findCursorCh('- foo', 'lineEnd', 'other'), 5);
		assert.equal(findCursorCh('', 'lineEnd', 'other'), 0);
	});

	test('lineEnd in a table is before the trailing pipe', () => {
		assert.equal(findCursorCh('| foo | bar |', 'lineEnd', 'table'), 11);
		assert.equal(findCursorCh('| foo | bar |  ', 'lineEnd', 'table'), 11);
		assert.equal(findCursorCh('|foo|bar|', 'lineEnd', 'table'), 8);
	});

	test('lineEnd in a table without a trailing pipe, or with an escaped one, is the end of the line', () => {
		assert.equal(findCursorCh('| foo | bar', 'lineEnd', 'table'), 11);
		assert.equal(findCursorCh('| foo | bar \\|', 'lineEnd', 'table'), 14);
	});
});

describe('findCursorCh (textStart)', () => {
	test('plain text: 0', () => {
		assert.equal(textStart('foo'), 0);
	});

	test('empty line: 0', () => {
		assert.equal(textStart(''), 0);
	});

	test('skips the indentation', () => {
		assert.equal(textStart('  foo'), 2);
		assert.equal(textStart('\tfoo'), 1);
	});

	test('skips bullet list markers', () => {
		assert.equal(textStart('- foo'), 2);
		assert.equal(textStart('* foo'), 2);
		assert.equal(textStart('+ foo'), 2);
		assert.equal(textStart('\t- foo'), 3);
	});

	test('skips ordered list markers', () => {
		assert.equal(textStart('1. foo'), 3);
		assert.equal(textStart('10) foo'), 4);
	});

	test('skips checkboxes of tasks', () => {
		assert.equal(textStart('- [ ] foo'), 6);
		assert.equal(textStart('- [x] foo'), 6);
		assert.equal(textStart('1. [/] foo'), 7);
	});

	test('skips a checkbox with no text after it', () => {
		assert.equal(textStart('- [ ]'), 5);
	});

	test('skips heading markers', () => {
		assert.equal(textStart('# foo'), 2);
		assert.equal(textStart('###### foo'), 7);
	});

	test('does not skip a tag or too many #', () => {
		assert.equal(textStart('#tag'), 0);
		assert.equal(textStart('####### foo'), 0);
	});

	test('skips quote markers, nested too', () => {
		assert.equal(textStart('> foo'), 2);
		assert.equal(textStart('> > foo'), 4);
		assert.equal(textStart('>foo'), 1);
	});

	test('skips quote markers and a marker inside the quote', () => {
		assert.equal(textStart('> - [ ] foo'), 8);
		assert.equal(textStart('> ## foo'), 5);
	});

	test('does not skip the type of a callout', () => {
		assert.equal(textStart('> [!note] Title'), 2);
	});

	test('skips the leading pipe of a table row', () => {
		assert.equal(textStart('| foo | bar |'), 2);
		assert.equal(textStart('|foo|bar|'), 1);
		assert.equal(textStart('foo | bar'), 0);
	});

	test('does not treat a thematic break or a marker without a space as a list', () => {
		assert.equal(textStart('---'), 0);
		assert.equal(textStart('-foo'), 0);
	});

	test('in a code block, skips only the indentation', () => {
		assert.equal(textStart('# comment', true), 0);
		assert.equal(textStart('  - item', true), 2);
	});
});
