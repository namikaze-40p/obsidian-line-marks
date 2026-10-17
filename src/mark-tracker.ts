import { Text, Transaction } from '@codemirror/state';
import type { MarkMeta } from './type';

// Marks are kept as offsets of line starts, and follow edits through CodeMirror's ChangeSet.
// However, operations that delete and reinsert lines (the other line of `Opt+↑↓`, moves by Outliner, renumbering, etc.)
// cannot be followed by mapping alone, so removed and added lines in the same transaction are matched again by text.

// `from` is the offset of the start of the marked line. `createdAt` is when it was marked (epoch milliseconds).
export type Mark = { from: number, createdAt: number } & MarkMeta;

type LineRef = { from: number, text: string };

// Upper limit of the LCS cost (removed lines x added lines). Above it, LCS is skipped and lines are matched only in order.
const LCS_LIMIT = 1000000;

// Normalizes list markers (`- ` / `* ` / `+ ` / `1. ` / `1) `) and checkbox states, so that lines still match after renumbering or toggling checkboxes.
const LIST_MARKER = /^(\s*)(?:[-*+]|\d+[.)])(?:\s+\[.\])?\s+/;

const normalize = (text: string): string => text.replace(LIST_MARKER, '$1- ');

// Also ignores leading whitespace, so that lines still match after changing the indent (Tab / Shift+Tab).
const normalizeIgnoreIndent = (text: string): string => normalize(text).replace(/^\s+/, '');

// Collects the lines whose start is in [from, to).
const collectLines = (doc: Text, ranges: [number, number][]): LineRef[] => {
	const lines: LineRef[] = [];
	const seen = new Set<number>();
	for (const [from, to] of ranges) {
		if (from === to) {
			continue;
		}
		for (let line = doc.lineAt(from); ; line = doc.line(line.number + 1)) {
			if (from <= line.from && line.from < to && !seen.has(line.from)) {
				seen.add(line.from);
				lines.push({ from: line.from, text: line.text });
			}
			if (line.to >= to || line.number === doc.lines) {
				break;
			}
		}
	}
	return lines;
};

const matchByLcs = (removed: LineRef[], added: LineRef[], result: Map<number, number>): void => {
	const n = removed.length;
	const m = added.length;
	const a = removed.map(line => normalize(line.text));
	const b = added.map(line => normalize(line.text));
	const table = new Uint32Array((n + 1) * (m + 1));
	const at = (i: number, j: number) => i * (m + 1) + j;
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[at(i, j)] = a[i] === b[j]
				? table[at(i + 1, j + 1)] + 1
				: Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
		}
	}
	for (let i = 0, j = 0; i < n && j < m;) {
		if (a[i] === b[j]) {
			result.set(i, j);
			i++;
			j++;
		} else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
			i++;
		} else {
			j++;
		}
	}
};

// Matches lines not matched by LCS with lines of the same text, in order from the top.
const matchInOrder = (removed: LineRef[], added: LineRef[], result: Map<number, number>, key: (text: string) => string): void => {
	const used = new Set(result.values());
	removed.forEach((line, i) => {
		if (result.has(i)) {
			return;
		}
		const text = key(line.text);
		const j = added.findIndex((addedLine, k) => !used.has(k) && key(addedLine.text) === text);
		if (j >= 0) {
			result.set(i, j);
			used.add(j);
		}
	});
};

// Index of a removed line -> index of an added line.
const matchLines = (removed: LineRef[], added: LineRef[]): Map<number, number> => {
	const result = new Map<number, number>();
	if (removed.length * added.length <= LCS_LIMIT) {
		matchByLcs(removed, added, result);
	}
	matchInOrder(removed, added, result, normalize);
	matchInOrder(removed, added, result, normalizeIgnoreIndent);
	return result;
};

// Whether the line was deleted together with its line break (not when only its text was selected and replaced).
const isLineDeleted = (doc: Text, from: number, ranges: [number, number][]): boolean => {
	const line = doc.lineAt(from);
	return ranges.some(([rangeFrom, rangeTo]) =>
		rangeFrom <= line.from && line.to <= rangeTo && (rangeFrom < line.from || line.to < rangeTo));
};

// Marks that end up on the same line are merged, keeping the one marked first (time, label, and color).
const addMark = (result: Map<number, Mark>, from: number, mark: Mark): void => {
	const existing = result.get(from);
	if (!existing || mark.createdAt < existing.createdAt) {
		result.set(from, { ...mark, from });
	}
};

export const sortMarks = (marks: Iterable<Mark>): Mark[] => Array.from(marks).sort((a, b) => a.from - b.from);

export const remapMarks = (marks: readonly Mark[], tr: Transaction): Mark[] => {
	const oldDoc = tr.startState.doc;
	const newDoc = tr.newDoc;
	const oldRanges: [number, number][] = [];
	const newRanges: [number, number][] = [];
	tr.changes.iterChanges((fromA, toA, fromB, toB) => {
		oldRanges.push([fromA, toA]);
		newRanges.push([fromB, toB]);
	});

	const removed = collectLines(oldDoc, oldRanges);
	const removedIndex = new Map(removed.map((line, i): [number, number] => [line.from, i]));
	const added = marks.some(({ from }) => removedIndex.has(from)) ? collectLines(newDoc, newRanges) : [];
	const matches = added.length ? matchLines(removed, added) : new Map<number, number>();

	const result = new Map<number, Mark>();
	for (const mark of marks) {
		const { from } = mark;
		const i = removedIndex.get(from);
		if (i !== undefined) {
			const j = matches.get(i);
			if (j !== undefined) {
				addMark(result, added[j].from, mark);
				continue;
			}
			if (isLineDeleted(oldDoc, from, oldRanges)) {
				continue;
			}
		}
		// assoc = 1: when a line break is inserted at the start of the line, the mark moves to the next line with the text.
		addMark(result, newDoc.lineAt(tr.changes.mapPos(from, 1)).from, mark);
	}
	return sortMarks(result.values());
};
