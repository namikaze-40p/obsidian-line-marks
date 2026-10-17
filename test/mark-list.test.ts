import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMarkListItems, groupMarkListItemsByColor, sortMarkListItems, summarizeLabels } from '../src/mark-list.ts';
import type { MarkListItem } from '../src/mark-list.ts';
import type { MarkMeta } from '../src/type.ts';

const item = (path: string, line: number, createdAt: number, isMissing = false): MarkListItem => ({ path, line, text: '', createdAt, isMissing });

describe('sortMarkListItems', () => {
	const items = [item('b.md', 3, 100), item('a.md', 10, 300), item('b.md', 1, 300), item('a.md', 2, 200)];
	const toKeys = (sorted: MarkListItem[]) => sorted.map(({ path, line }) => `${path}:${line}`);

	test('fileName: by file name, then by line within a file', () => {
		assert.deepEqual(toKeys(sortMarkListItems(items, 'fileName')), ['a.md:2', 'a.md:10', 'b.md:1', 'b.md:3']);
	});

	test('dateMarked: newest first, then by file name and line on the same time', () => {
		assert.deepEqual(toKeys(sortMarkListItems(items, 'dateMarked')), ['a.md:10', 'b.md:1', 'a.md:2', 'b.md:3']);
	});

	test('marks of missing files come last, regardless of the order', () => {
		const withMissing = [item('0.md', 1, 999, true), ...items, item('a.md', 1, 0, true)];
		assert.deepEqual(toKeys(sortMarkListItems(withMissing, 'fileName')), ['a.md:2', 'a.md:10', 'b.md:1', 'b.md:3', '0.md:1', 'a.md:1']);
		assert.deepEqual(toKeys(sortMarkListItems(withMissing, 'dateMarked')), ['a.md:10', 'b.md:1', 'a.md:2', 'b.md:3', '0.md:1', 'a.md:1']);
	});

	test('does not change the original array', () => {
		const copy = [...items];
		sortMarkListItems(items, 'fileName');
		assert.deepEqual(items, copy);
	});
});

describe('groupMarkListItems', () => {
	test('groups by file, sorted by file name and line', () => {
		const groups = groupMarkListItems([item('b.md', 3, 100), item('a.md', 10, 300), item('b.md', 1, 300), item('a.md', 2, 200)]);
		assert.deepEqual(groups.map(({ path, items }) => [path, items.map(({ line }) => line)]), [['a.md', [2, 10]], ['b.md', [1, 3]]]);
	});

	test('missing files come last', () => {
		const groups = groupMarkListItems([item('0.md', 1, 0, true), item('a.md', 1, 0)]);
		assert.deepEqual(groups.map(({ path, isMissing }) => [path, isMissing]), [['a.md', false], ['0.md', true]]);
	});

	test('empty when there are no marks', () => {
		assert.deepEqual(groupMarkListItems([]), []);
	});
});

describe('summarizeLabels', () => {
	test('groups by label, sorted by count (by label on a tie)', () => {
		const labels = summarizeLabels([
			{ createdAt: 0, label: 'b' },
			{ createdAt: 0, label: 'a' },
			{ createdAt: 0, label: 'c' },
			{ createdAt: 0, label: 'c' },
			{ createdAt: 0 },
		]);
		assert.deepEqual(labels, [{ label: 'c', count: 2 }, { label: 'a', count: 1 }, { label: 'b', count: 1 }]);
	});

	test('the color is the one used most with the label', () => {
		const labels = summarizeLabels([
			{ createdAt: 3, label: 'a', color: 'red' },
			{ createdAt: 1, label: 'a', color: 'blue' },
			{ createdAt: 2, label: 'a', color: 'blue' },
		]);
		assert.deepEqual(labels, [{ label: 'a', count: 3, color: 'blue' }]);
	});

	test('on a tie of colors, uses the color marked last', () => {
		assert.deepEqual(summarizeLabels([{ createdAt: 2, label: 'a', color: 'red' }, { createdAt: 1, label: 'a', color: 'blue' }]), [{ label: 'a', count: 2, color: 'red' }]);
		assert.deepEqual(summarizeLabels([{ createdAt: 2, label: 'a' }, { createdAt: 1, label: 'a', color: 'blue' }]), [{ label: 'a', count: 2 }]);
	});
});

describe('grouping by color', () => {
	const colored = (path: string, line: number, meta: MarkMeta, text = '', isMissing = false): MarkListItem => ({ path, line, text, createdAt: 0, isMissing, ...meta });
	const toKeys = (items: MarkListItem[]) => items.map(({ path, line }) => `${path}:${line}`);

	test('color of sortMarkListItems: by color (no color last), then by label (or text), file name, and line', () => {
		const items = [
			colored('a.md', 1, {}),
			colored('b.md', 1, { color: 'blue', label: 'y' }),
			colored('a.md', 2, { color: 'red', label: 'z' }),
			colored('a.md', 3, { color: 'blue' }, 'x'),
			colored('a.md', 4, { color: 'blue', label: 'y' }),
		];
		assert.deepEqual(toKeys(sortMarkListItems(items, 'color')), ['a.md:2', 'a.md:3', 'a.md:4', 'b.md:1', 'a.md:1']);
	});

	test('groupMarkListItemsByColor: groups by color, in the order of colors', () => {
		const groups = groupMarkListItemsByColor([colored('a.md', 1, {}), colored('a.md', 2, { color: 'green' }), colored('a.md', 3, { color: 'red' }), colored('b.md', 1, { color: 'red' })]);
		assert.deepEqual(groups.map(({ color, items }) => [color, toKeys(items)]), [['red', ['a.md:3', 'b.md:1']], ['green', ['a.md:2']], [undefined, ['a.md:1']]]);
	});

	test('groupMarkListItemsByColor: a color with only marks of missing files is also in the order of colors', () => {
		const groups = groupMarkListItemsByColor([colored('a.md', 1, { color: 'green' }), colored('x.md', 1, { color: 'red' }, '', true)]);
		assert.deepEqual(groups.map(({ color }) => color), ['red', 'green']);
	});
});
