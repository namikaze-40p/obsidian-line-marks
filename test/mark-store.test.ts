import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkStore } from '../src/mark-store.ts';
import type { SavedFile } from '../src/type.ts';

const file = (...lines: number[]): SavedFile => ({ ctime: 1, marks: lines.map(line => ({ line, text: `line ${line}`, createdAt: line })) });

// Returns the store, the paths notified to the editors, and the number of changes notified to the mark lists.
const createStore = (files: Record<string, SavedFile>) => {
	const store = new MarkStore(files, () => {});
	const notified: string[] = [];
	const changes = { count: 0 };
	store.subscribe(path => notified.push(path));
	store.onChange(() => changes.count++);
	return { store, notified, changes };
};

describe('MarkStore.replaceAll', () => {
	test('replaces the marks of all files', () => {
		const { store } = createStore({ 'a.md': file(1), 'b.md': file(2) });
		store.replaceAll({ 'a.md': file(3), 'c.md': file(4) });
		assert.deepEqual(store.paths(), ['a.md', 'c.md']);
		assert.deepEqual(store.get('a.md').map(({ line }) => line), [3]);
		assert.deepEqual(store.get('b.md'), []);
	});

	test('notifies the changed, added, and removed files', () => {
		const { store, notified, changes } = createStore({ 'a.md': file(1), 'b.md': file(2), 'c.md': file(3) });
		store.replaceAll({ 'a.md': file(1), 'b.md': file(5), 'd.md': file(4) });
		assert.deepEqual(notified.sort(), ['b.md', 'c.md', 'd.md']);
		assert.equal(changes.count, 1);
	});

	test('notifies nothing when nothing has changed', () => {
		const { store, notified, changes } = createStore({ 'a.md': file(1) });
		store.replaceAll({ 'a.md': file(1) });
		assert.deepEqual(notified, []);
		assert.equal(changes.count, 0);
	});

	test('notifies the file whose ctime has changed', () => {
		const { store, notified } = createStore({ 'a.md': file(1) });
		store.replaceAll({ 'a.md': { ...file(1), ctime: 2 } });
		assert.deepEqual(notified, ['a.md']);
	});

	test('later changes are made to the new data', () => {
		const files = { 'a.md': file(1) };
		const { store } = createStore({});
		store.replaceAll(files);
		store.set('a.md', file(2).marks);
		assert.deepEqual(files['a.md'].marks.map(({ line }) => line), [2]);
	});
});
