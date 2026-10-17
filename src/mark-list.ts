import type { MarkColor, MarkMeta } from './type';

// An item in the mark lists. `isMissing` means the file was not found (renamed or deleted outside Obsidian).
export type MarkListItem = { path: string, line: number, text: string, createdAt: number, isMissing: boolean } & MarkMeta;

export type MarkListSortOrder = 'fileName' | 'dateMarked' | 'color';

// Order of colors: the same as the color buttons (MARK_COLORS in color.ts), with no color last (shown last as unclassified).
const COLOR_ORDER: (MarkColor | undefined)[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', undefined];

// Unexpected values in the saved data are treated as no color.
const colorIndex = (color: MarkColor | undefined): number => {
	const index = COLOR_ORDER.indexOf(color);
	return index < 0 ? COLOR_ORDER.length - 1 : index;
};

const compareByFileName = (a: MarkListItem, b: MarkListItem): number =>
	a.path.localeCompare(b.path) || a.line - b.line;

// By color, then by label (or line text if no label), file name, and line.
const compareByColor = (a: MarkListItem, b: MarkListItem): number =>
	colorIndex(a.color) - colorIndex(b.color) || (a.label || a.text).localeCompare(b.label || b.text) || compareByFileName(a, b);

const COMPARERS: Record<MarkListSortOrder, (a: MarkListItem, b: MarkListItem) => number> = {
	fileName: compareByFileName,
	dateMarked: (a, b) => b.createdAt - a.createdAt || compareByFileName(a, b),
	color: compareByColor,
};

// Marks of missing files come last, regardless of the order.
export const sortMarkListItems = (items: MarkListItem[], order: MarkListSortOrder): MarkListItem[] => {
	return [...items].sort((a, b) => Number(a.isMissing) - Number(b.isMissing) || COMPARERS[order](a, b));
};

export type MarkListGroup = { path: string, isMissing: boolean, items: MarkListItem[] };

// For the sidebar. Groups by file, sorted by file name and line. Missing files come last.
export const groupMarkListItems = (items: MarkListItem[]): MarkListGroup[] => {
	const groups = new Map<string, MarkListGroup>();
	for (const item of sortMarkListItems(items, 'fileName')) {
		const group = groups.get(item.path);
		if (group) {
			group.items.push(item);
		} else {
			groups.set(item.path, { path: item.path, isMissing: item.isMissing, items: [item] });
		}
	}
	return [...groups.values()];
};

// How marks are grouped in the sidebar.
export type MarkListGroupBy = 'file' | 'color';

export type MarkListColorGroup = { color: MarkColor | undefined, items: MarkListItem[] };

// For the sidebar. Groups by color, in the order of colors (no color last). Within a group, the order is the same as 'color' of sortMarkListItems.
export const groupMarkListItemsByColor = (items: MarkListItem[]): MarkListColorGroup[] => {
	const groups = new Map<MarkColor | undefined, MarkListColorGroup>();
	for (const item of sortMarkListItems(items, 'color')) {
		const group = groups.get(item.color);
		if (group) {
			group.items.push(item);
		} else {
			groups.set(item.color, { color: item.color, items: [item] });
		}
	}
	// A color with only marks of missing files appears late, so sort the groups by color again.
	return [...groups.values()].sort((a, b) => colorIndex(a.color) - colorIndex(b.color));
};

// A label suggestion. `color` is the color used most with the label (on a tie, the one marked last).
export type LabelCandidate = { label: string, color?: MarkColor, count: number };

type ColorUsage = { count: number, latest: number };

// Counts the labels in use, sorted by count (on a tie, by label).
export const summarizeLabels = (marks: Iterable<{ createdAt: number } & MarkMeta>): LabelCandidate[] => {
	const labels = new Map<string, { count: number, colors: Map<MarkColor | undefined, ColorUsage> }>();
	for (const { label, color, createdAt } of marks) {
		if (!label) {
			continue;
		}
		const entry = labels.get(label) ?? { count: 0, colors: new Map<MarkColor | undefined, ColorUsage>() };
		labels.set(label, entry);
		entry.count++;
		const usage = entry.colors.get(color) ?? { count: 0, latest: -Infinity };
		entry.colors.set(color, { count: usage.count + 1, latest: Math.max(usage.latest, createdAt) });
	}
	return [...labels].map(([label, { count, colors }]): LabelCandidate => {
		const [color] = [...colors].reduce((best, current) => {
			const [, a] = best;
			const [, b] = current;
			return b.count > a.count || (b.count === a.count && b.latest > a.latest) ? current : best;
		});
		return { label, count, ...(color && { color }) };
	}).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};
