import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import type { ChangeSpec } from '@codemirror/state';
import { remapMarks } from '../src/mark-tracker.ts';

// Returns the marks after applying the changes, as [line number (1-based), time marked] pairs.
const remapWithCreatedAt = (lines: string[], marks: [line: number, createdAt: number][], changes: ChangeSpec): [number, number][] => {
	const state = EditorState.create({ doc: lines.join('\n') });
	const tr = state.update({ changes });
	const before = marks.map(([line, createdAt]) => ({ from: state.doc.line(line).from, createdAt }));
	return remapMarks(before, tr).map(({ from, createdAt }) => [tr.newDoc.lineAt(from).number, createdAt]);
};

// Returns the line numbers (1-based) of the marks after applying the changes.
const remap = (lines: string[], marks: number[], changes: ChangeSpec): number[] =>
	remapWithCreatedAt(lines, marks.map(line => [line, 0]), changes).map(([line]) => line);

// The offset of the start of line `line`.
const offset = (lines: string[], line: number): number =>
	lines.slice(0, line - 1).reduce((acc, text) => acc + text.length + 1, 0);

// The same changes as `Opt+↓` in Obsidian (userEvent: move.line).
// The moved block is left as is; the next line is inserted before the block and deleted after it.
const moveLineDown = (lines: string[], line: number): ChangeSpec => {
	const from = offset(lines, line);
	const to = from + lines[line - 1].length;
	return [
		{ from, insert: `${lines[line]}\n` },
		{ from: to, to: to + 1 + lines[line].length },
	];
};

// The same changes as Outliner and renumbering: lines `start` to `end` are replaced in a single change.
const replaceLines = (lines: string[], start: number, end: number, insert: string[]): ChangeSpec => ({
	from: offset(lines, start),
	to: offset(lines, end) + lines[end - 1].length,
	insert: insert.join('\n'),
});

describe('swapping lines with Opt+↑↓', () => {
	const lines = ['aaa', 'bbb', '- a', '- a', '- b'];

	test('the mark on the moved line follows it', () => {
		assert.deepEqual(remap(lines, [1], moveLineDown(lines, 1)), [2]);
	});

	test('the mark on the other line follows it', () => {
		assert.deepEqual(remap(lines, [2], moveLineDown(lines, 1)), [1]);
	});

	test('the marks on both lines follow them', () => {
		assert.deepEqual(remap(lines, [1, 2], moveLineDown(lines, 1)), [1, 2]);
	});

	test('the mark on the moved line follows it, even with identical lines', () => {
		assert.deepEqual(remap(lines, [3], moveLineDown(lines, 3)), [4]);
	});

	test('the mark on the other line follows it, even with identical lines', () => {
		assert.deepEqual(remap(lines, [4], moveLineDown(lines, 3)), [3]);
	});

	test('a mark on an identical line elsewhere does not move', () => {
		assert.deepEqual(remap(lines, [4], moveLineDown(lines, 1)), [4]);
	});
});

describe('moving with Outliner', () => {
	const lines = ['- p', '    - c1', '    - c2', '- q'];
	const moved = ['- q', '- p', '    - c1', '    - c2'];

	test('the mark on the parent item follows it', () => {
		assert.deepEqual(remap(lines, [1], replaceLines(lines, 1, 4, moved)), [2]);
	});

	test('the mark on the child item follows it', () => {
		assert.deepEqual(remap(lines, [2, 3], replaceLines(lines, 1, 4, moved)), [3, 4]);
	});

	test('the mark on the other item follows it', () => {
		assert.deepEqual(remap(lines, [4], replaceLines(lines, 1, 4, moved)), [1]);
	});

	describe('with an identical line outside the replaced range', () => {
		const lines = ['- a', '- a', '- b'];
		const changes = replaceLines(lines, 2, 3, ['- b', '- a']);

		test('the mark on the moved item follows it', () => {
			assert.deepEqual(remap(lines, [2], changes), [3]);
		});

		test('the mark on the other item follows it', () => {
			assert.deepEqual(remap(lines, [3], changes), [2]);
		});

		test('the mark on the identical line outside the range does not move', () => {
			assert.deepEqual(remap(lines, [1], changes), [1]);
		});
	});
});

describe('changes of list markers', () => {
	// The changes made by pressing Enter at the end of `1. one` (with Outliner enabled).
	const lines = ['1. one', '2. two', '3. three'];
	const changes = replaceLines(lines, 2, 3, ['2. ', '3. two', '4. three']);

	test('the mark on a renumbered item follows it', () => {
		assert.deepEqual(remap(lines, [2, 3], changes), [3, 4]);
	});

	test('the mark on an item outside the replaced range does not move', () => {
		assert.deepEqual(remap(lines, [1], changes), [1]);
	});

	test('the mark stays when the checkbox is toggled', () => {
		const lines = ['- [ ] a', '- [ ] b'];
		assert.deepEqual(remap(lines, [1], replaceLines(lines, 1, 1, ['- [x] a'])), [1]);
	});

	test('the mark stays when the indent is changed', () => {
		const lines = ['- a', '- b'];
		assert.deepEqual(remap(lines, [2], replaceLines(lines, 2, 2, ['    - b'])), [2]);
	});
});

describe('regular editing', () => {
	const lines = ['aaa', 'bbb', 'ccc'];

	test('a line break at the start of the line moves the mark to the next line with the text', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2), insert: '\n' }), [3]);
	});

	test('a line break at the end of the line does not move the mark', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2) + 3, insert: '\n' }), [2]);
	});

	test('a line break in the middle of the line does not move the mark', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2) + 1, insert: '\n' }), [2]);
	});

	test('typing in the line does not move the mark', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2) + 1, insert: 'x' }), [2]);
	});

	test('inserting a line above moves the mark down', () => {
		assert.deepEqual(remap(lines, [3], { from: 0, insert: 'x\ny\n' }), [5]);
	});

	test('deleting the line with its line break removes its mark', () => {
		assert.deepEqual(remap(lines, [2, 3], { from: offset(lines, 2), to: offset(lines, 3) }), [2]);
	});

	test('Backspace at the start of the line moves the mark to the joined line', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2) - 1, to: offset(lines, 2) }), [1]);
	});

	test('the mark stays when only the text of the line is selected and replaced', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2), to: offset(lines, 2) + 3, insert: 'zzz' }), [2]);
	});

	test('typing a tab at the start of the line does not move the mark', () => {
		assert.deepEqual(remap(lines, [2], { from: offset(lines, 2), insert: '\t' }), [2]);
	});
});

describe('time marked', () => {
	test('marks on swapped lines keep their own times', () => {
		const lines = ['aaa', 'bbb'];
		assert.deepEqual(remapWithCreatedAt(lines, [[1, 100], [2, 200]], moveLineDown(lines, 1)), [[1, 200], [2, 100]]);
	});

	test('marks moved with Outliner keep their times', () => {
		const lines = ['- p', '    - c1', '- q'];
		const changes = replaceLines(lines, 1, 3, ['- q', '- p', '    - c1']);
		assert.deepEqual(remapWithCreatedAt(lines, [[1, 100], [3, 300]], changes), [[1, 300], [2, 100]]);
	});

	test('when lines are joined and marks overlap, keeps the time of the one marked first', () => {
		const lines = ['aaa', 'bbb'];
		const changes = { from: offset(lines, 2) - 1, to: offset(lines, 2) };
		assert.deepEqual(remapWithCreatedAt(lines, [[1, 200], [2, 100]], changes), [[1, 100]]);
	});
});

describe('label and color', () => {
	test('keeps the label and color when the line is moved', () => {
		const lines = ['aaa', 'bbb', 'ccc'];
		const state = EditorState.create({ doc: lines.join('\n') });
		const tr = state.update({ changes: moveLineDown(lines, 1) });
		const marks = remapMarks([{ from: 0, createdAt: 0, label: 'memo', color: 'red' }], tr);
		assert.deepEqual(marks.map(({ from, ...rest }) => ({ line: tr.newDoc.lineAt(from).number, ...rest })), [{ line: 2, createdAt: 0, label: 'memo', color: 'red' }]);
	});

	test('when marks overlap on the same line, keeps the label and color of the one marked first', () => {
		const lines = ['aaa', 'bbb'];
		const state = EditorState.create({ doc: lines.join('\n') });
		const tr = state.update({ changes: { from: offset(lines, 2) - 1, to: offset(lines, 2) } });
		const marks = remapMarks([{ from: 0, createdAt: 200, label: 'new' }, { from: offset(lines, 2), createdAt: 100, label: 'old', color: 'blue' }], tr);
		assert.deepEqual(marks, [{ from: 0, createdAt: 100, label: 'old', color: 'blue' }]);
	});
});
