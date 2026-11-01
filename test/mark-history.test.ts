import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, StateField, Transaction } from '@codemirror/state';
import type { ChangeSpec } from '@codemirror/state';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { applyRestoredMarks, invertMarkRemoval, remapMarks } from '../src/mark-tracker.ts';
import type { Mark } from '../src/mark-tracker.ts';
import type { MarkMeta } from '../src/type.ts';

type InitialMark = { line: number, createdAt: number } & MarkMeta;

// An editor with the history and a field that updates marks in the same way as marksField (except marking and unmarking).
const createEditor = (lines: string[], initialMarks: InitialMark[]) => {
	const field = StateField.define<Mark[]>({
		create: state => initialMarks.map(({ line, ...mark }) => ({ ...mark, from: state.doc.line(line).from })),
		update: (marks, tr) => applyRestoredMarks(tr.docChanged ? remapMarks(marks, tr) : marks, tr),
	});
	let state = EditorState.create({ doc: lines.join('\n'), extensions: [field, invertMarkRemoval(field), history()] });
	const target = { get state() { return state; }, dispatch: (tr: { state: EditorState }) => { state = tr.state; } };
	return {
		// Each change is a separate undo step. `addToHistory` is false for a change that cannot be undone.
		change: (changes: ChangeSpec, addToHistory = true) => {
			state = state.update({ changes, annotations: [isolateHistory.of('full'), Transaction.addToHistory.of(addToHistory)] }).state;
		},
		undo: () => assert.ok(undo(target)),
		redo: () => assert.ok(redo(target)),
		// The marks as [line number (1-based), time marked] pairs.
		marks: (): [number, number][] => state.field(field).map(({ from, createdAt }) => [state.doc.lineAt(from).number, createdAt]),
		field: () => state.field(field),
	};
};

describe('undoing an edit that removed marks', () => {
	const lines = ['aaa', 'bbb', 'ccc'];
	// Deletes line 2 with its line break.
	const deleteLine2 = { from: 4, to: 8 };

	test('puts back the mark on a deleted line', () => {
		const editor = createEditor(lines, [{ line: 2, createdAt: 1 }]);
		editor.change(deleteLine2);
		assert.deepEqual(editor.marks(), []);
		editor.undo();
		assert.deepEqual(editor.marks(), [[2, 1]]);
	});

	test('keeps the label and color', () => {
		const editor = createEditor(lines, [{ line: 2, createdAt: 1, label: 'todo', color: 'red' }]);
		editor.change(deleteLine2);
		editor.undo();
		assert.deepEqual(editor.field().map(({ label, color }) => ({ label, color })), [{ label: 'todo', color: 'red' }]);
	});

	test('keeps the other marks as they are', () => {
		const editor = createEditor(lines, [{ line: 1, createdAt: 1 }, { line: 2, createdAt: 2 }, { line: 3, createdAt: 3 }]);
		editor.change(deleteLine2);
		assert.deepEqual(editor.marks(), [[1, 1], [2, 3]]);
		editor.undo();
		assert.deepEqual(editor.marks(), [[1, 1], [2, 2], [3, 3]]);
	});

	test('redo removes the mark again, and undo puts it back again', () => {
		const editor = createEditor(lines, [{ line: 2, createdAt: 1 }]);
		editor.change(deleteLine2);
		editor.undo();
		editor.redo();
		assert.deepEqual(editor.marks(), []);
		editor.undo();
		assert.deepEqual(editor.marks(), [[2, 1]]);
	});

	test('puts back the mark merged into another mark on the same line', () => {
		const editor = createEditor(lines, [{ line: 1, createdAt: 1 }, { line: 2, createdAt: 2 }]);
		// Joins lines 1 and 2.
		editor.change({ from: 3, to: 4 });
		assert.deepEqual(editor.marks(), [[1, 1]]);
		editor.undo();
		assert.deepEqual(editor.marks(), [[1, 1], [2, 2]]);
	});

	test('puts back the mark on the right line after changes not in the history', () => {
		const editor = createEditor(lines, [{ line: 2, createdAt: 1 }]);
		editor.change(deleteLine2);
		// e.g. a change made by another plugin, or the file changed outside the editor.
		editor.change({ from: 0, insert: 'new\n' }, false);
		editor.undo();
		assert.deepEqual(editor.marks(), [[3, 1]]);
	});
});
