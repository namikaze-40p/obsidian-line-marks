import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { pickMeta, restoreMarks } from '../src/mark-restore.ts';
import type { SavedFile } from '../src/type.ts';

// Returns the line numbers (1-based) of the restored marks.
const restore = (lines: string[], saved: SavedFile, ctime: number): number[] => {
	const doc = Text.of(lines);
	return restoreMarks(doc, saved, ctime).map(({ from }) => doc.lineAt(from).number);
};

describe('restoreMarks', () => {
	const lines = ['aaa', 'bbb', 'ccc'];

	test('no marks without saved data', () => {
		assert.deepEqual(restoreMarks(Text.of(lines), undefined, 1), []);
	});

	describe('same ctime (same file)', () => {
		test('puts marks on lines whose text matches', () => {
			assert.deepEqual(restore(lines, { ctime: 1, marks: [{ line: 2, text: 'bbb', createdAt: 0 }] }, 1), [2]);
		});

		test('if lines have shifted, puts marks on the nearest line with the same text', () => {
			assert.deepEqual(restore(['x', ...lines], { ctime: 1, marks: [{ line: 2, text: 'bbb', createdAt: 0 }] }, 1), [3]);
		});

		test('puts marks on their original line numbers even if the text is not found', () => {
			assert.deepEqual(restore(lines, { ctime: 1, marks: [{ line: 2, text: 'zzz', createdAt: 0 }] }, 1), [2]);
		});

		test('does not put marks beyond the line count of the file', () => {
			assert.deepEqual(restore(lines, { ctime: 1, marks: [{ line: 9, text: 'zzz', createdAt: 0 }] }, 1), []);
		});
	});

	describe('different ctime (may not be the same file)', () => {
		test('puts marks on lines whose text matches', () => {
			assert.deepEqual(restore(['x', ...lines], { ctime: 1, marks: [{ line: 2, text: 'bbb', createdAt: 0 }] }, 2), [3]);
		});

		test('does not put marks whose text is not found', () => {
			assert.deepEqual(restore(lines, { ctime: 1, marks: [{ line: 2, text: 'zzz', createdAt: 0 }] }, 2), []);
		});

	});

});

describe('label and color', () => {
	test('restored marks keep their label and color', () => {
		const saved: SavedFile = { ctime: 1, marks: [{ line: 2, text: 'bbb', createdAt: 5, label: 'memo', color: 'green' }] };
		assert.deepEqual(restoreMarks(Text.of(['aaa', 'bbb']), saved, 1), [{ from: 4, createdAt: 5, label: 'memo', color: 'green' }]);
	});

	test('omits the properties when there is no label or color', () => {
		const saved: SavedFile = { ctime: 1, marks: [{ line: 1, text: 'aaa', createdAt: 5 }] };
		assert.deepEqual(restoreMarks(Text.of(['aaa']), saved, 1), [{ from: 0, createdAt: 5 }]);
	});
});

describe('pickMeta', () => {
	test('picks only the values that exist', () => {
		assert.deepEqual(pickMeta({ label: 'memo', color: 'red' }), { label: 'memo', color: 'red' });
		assert.deepEqual(pickMeta({ label: '', color: undefined }), {});
	});
});
