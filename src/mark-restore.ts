import { Text } from '@codemirror/state';
// Tests run directly on Node, so only types are imported from relative paths without an extension (value imports cannot be resolved at runtime).
import type { Mark } from './mark-tracker';
import type { MarkMeta, SavedFile, SavedMark } from './type';

// Picks only the label and color that have a value.
export const pickMeta = ({ label, color }: MarkMeta): MarkMeta => ({ ...(label && { label }), ...(color && { color }) });

// Puts the saved marks back on the lines of the opened file.
//
// If `ctime` is the same as when saved, the file is regarded as the same, and marks whose text is not found are put on their original line numbers (in case lines were edited outside Obsidian).
// If `ctime` differs (recreated by sync or git, or deleted outside Obsidian and created again at the same path), it may not be the same file,
// so only marks whose text matches a line are put back.
export const restoreMarks = (doc: Text, saved: SavedFile | undefined, ctime: number | undefined): Mark[] => {
	if (!saved) {
		return [];
	}
	const isSameFile = saved.ctime === ctime;
	const marks = new Map<number, Mark>();
	saved.marks.forEach(mark => {
		const line = findLine(doc, mark, isSameFile);
		if (line !== null) {
			const from = doc.line(line).from;
			marks.set(from, { from, createdAt: mark.createdAt, ...pickMeta(mark) });
		}
	});
	return Array.from(marks.values()).sort((a, b) => a.from - b.from);
};

// If the text of the saved line does not match, looks for the nearest line with the same text.
const findLine = (doc: Text, { line, text }: SavedMark, isSameFile: boolean): number | null => {
	for (let distance = 0; line - distance >= 1 || line + distance <= doc.lines; distance++) {
		for (const candidate of [line - distance, line + distance]) {
			if (1 <= candidate && candidate <= doc.lines && doc.line(candidate).text === text) {
				return candidate;
			}
		}
	}
	return isSameFile && line <= doc.lines ? line : null;
};
