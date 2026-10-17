import { MarkColor } from './type';

// Colors use the theme colors of Obsidian (`--color-*`), so that they are readable in both light and dark themes.
export const MARK_COLORS: Record<MarkColor, string> = {
	red: 'Red',
	orange: 'Orange',
	yellow: 'Yellow',
	green: 'Green',
	blue: 'Blue',
	purple: 'Purple',
};

// The class for a color. No color is `is-none` (filled with the text color).
export const colorClass = (color: MarkColor | undefined): string => color ? `line-marks-color-${color}` : 'is-none';
