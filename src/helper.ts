import { App, Editor, EditorPosition, MarkdownView, TFile } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { CustomWsLeaf, WindowItem } from './type';
import { LineBlock } from './cursor-position';

const setCursor = (editor: Editor, pos: EditorPosition): void => {
	editor.setCursor(pos);
	// Focus the editor of the note itself. editor.focus() focuses the editor of a table cell instead while it is open (in Live Preview),
	// which keeps showing the cursor in the table after jumping elsewhere.
	(editor as Editor & { cm: EditorView }).cm.focus();
};

// The kind of block the line (0-based) is in, according to the metadata cache.
// The cache can lag behind the latest edits for a moment, which only affects where the cursor is placed.
const findLineBlock = (app: App, file: TFile | null, line: number): LineBlock => {
	const sections = file ? app.metadataCache.getFileCache(file)?.sections : undefined;
	const section = sections?.find(({ position }) => position.start.line <= line && line <= position.end.line);
	switch (section?.type) {
		case 'code':
		case 'math':
			return 'code';
		case 'table':
			return 'table';
		default:
			return 'other';
	}
};

const getExistingLeaf = (app: App, path: string): CustomWsLeaf | undefined => {
	// When opening from the sidebar, no editor is active, so use the most recently active tab instead.
	const baseLeaf = app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? app.workspace.getMostRecentLeaf();
	const activeLeafId = (baseLeaf as CustomWsLeaf | null)?.id || '';
	const windows = generateWindows(app.workspace.getLeavesOfType('markdown') as CustomWsLeaf[]);
	const window = windows.find(win => !!win.leaves.find(leaf => leaf.id === activeLeafId));
	return window?.leaves.find(leaf => {
		const { file, state } = leaf.view;
		return file?.path === path || state?.file === path;
	});
};

const generateWindows = (leaves: CustomWsLeaf[]): WindowItem[] => {
	return leaves.reduce((acc, cur) => {
		const win = acc.find(window => window.id === cur.parent?.id || '');
		if (win) {
			win.leaves = [...win.leaves, cur];
			return acc;
		} else {
			const newWindow = cur.containerEl?.ownerDocument.defaultView ?? window;
			return [...acc, { id: cur.parent?.id || '', window: newWindow, leaves: [cur] }];
		}
	}, [] as WindowItem[]);
};

export const helpers = {
	setCursor,
	findLineBlock,
	getExistingLeaf,
};
