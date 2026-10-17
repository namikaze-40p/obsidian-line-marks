import { App, Editor, MarkdownView } from 'obsidian';
import { CustomWsLeaf, WindowItem } from './type';

const setCursor = (editor: Editor, line: number): void => {
	editor.setCursor({ line, ch: 0 });
	editor.focus();
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
	getExistingLeaf,
};
