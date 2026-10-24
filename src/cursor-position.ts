// Where to place the cursor on the line after jumping to a mark.
export type CursorPosition = 'lineStart' | 'textStart' | 'lineEnd';

// The markers before the text: indentation, quote markers (nested too), then one of
// a list marker (with an optional checkbox), a heading marker, or the leading pipe of a table row.
// A callout (`> [!note]`) is not skipped after its quote marker, because `[!note]` is part of the text.
const MARKDOWN_PREFIX = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\](?:[ \t]+|$))?|#{1,6}(?:[ \t]+|$)|\|[ \t]*)?/;
const INDENT = /^[ \t]*/;
// The trailing pipe of a table row (not an escaped one), with the spaces around it.
const TABLE_SUFFIX = /[ \t]*(?<!\\)\|[ \t]*$/;

// The kind of block the line is in. In a code block or a math block (`code`), the markers are not Markdown, so only the indentation is skipped.
// In a table, the end of the line is before the trailing pipe, the end of the last cell.
// (In Live Preview, a position after the trailing pipe is not in any cell, and Obsidian moves the cursor elsewhere in the table.)
export type LineBlock = 'code' | 'table' | 'other';

// Returns the column (ch) to place the cursor at on the line with the given text.
export const findCursorCh = (text: string, position: CursorPosition, block: LineBlock): number => {
	switch (position) {
		case 'lineStart':
			return 0;
		case 'lineEnd':
			return text.length - (block === 'table' ? TABLE_SUFFIX.exec(text)?.[0].length ?? 0 : 0);
		case 'textStart':
			return (block === 'code' ? INDENT : MARKDOWN_PREFIX).exec(text)?.[0].length ?? 0;
	}
};
