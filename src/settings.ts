import { App, Platform, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import LineMarks from './main';
import { SavedFile } from './type';
import { formatShortcut, Shortcut, shortcutFromEvent } from './shortcut';
import { MarkListGroupBy, MarkListSortOrder } from './mark-list';
import { MARK_COLORS } from './color';
import { MarkColor } from './type';
import { CursorPosition } from './cursor-position';

export const LIST_SORT_ORDER: Record<MarkListSortOrder, string> = {
	fileName: 'File name and line',
	dateMarked: 'Date marked (newest first)',
	color: 'Color',
};

export const SIDEBAR_GROUP_BY: Record<MarkListGroupBy, string> = {
	file: 'File',
	color: 'Color',
};

// Where to open the file of the target mark when it is not open yet.
export type OpenIn = 'current' | 'new';

export const OPEN_IN: Record<OpenIn, string> = {
	current: 'Current tab',
	new: 'New tab',
};

export const CURSOR_POSITION: Record<CursorPosition, string> = {
	lineStart: 'Start of line',
	textStart: 'Start of text',
	lineEnd: 'End of line',
};

export interface Settings {
	isAllowCrossFile: boolean;
	openIn: OpenIn;
	cursorPosition: CursorPosition;
	isShowScrollbarMarks: boolean;
	// Color of new marks.
	defaultColor: MarkColor | 'none';
	listSortOrder: MarkListSortOrder;
	// How marks are grouped in the sidebar. Can be switched from both the toolbar in the sidebar and the setting tab.
	sidebarGroupBy: MarkListGroupBy;
	unmarkShortcut: Shortcut;
	// File path -> marks.
	files: Record<string, SavedFile>;
}

export const DEFAULT_SETTINGS: Settings = {
	isAllowCrossFile: true,
	openIn: 'current',
	cursorPosition: 'lineStart',
	isShowScrollbarMarks: true,
	defaultColor: 'none',
	listSortOrder: 'fileName',
	sidebarGroupBy: 'file',
	// Ctrl+X does nothing in input fields on macOS. On Windows / Linux, Ctrl+X is cut, so use Alt+X.
	unmarkShortcut: { modifiers: [Platform.isMacOS ? 'Ctrl' : 'Alt'], code: 'KeyX' },
	files: {},
} as const;


export class SettingTab extends PluginSettingTab {
	plugin: LineMarks;

	constructor(app: App, plugin: LineMarks) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Control values are read from and written to this.plugin.settings and saved by the default implementation of PluginSettingTab.
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Allow cross file',
				desc: 'When enabled, jumping moves on to other files with marks. When disabled, jumping wraps around within the current file.',
				control: { type: 'toggle', key: 'isAllowCrossFile', defaultValue: DEFAULT_SETTINGS.isAllowCrossFile },
			},
			{
				name: 'Open in',
				desc: 'Where to open a file when you jump to a mark in a file that is not open yet. If the file is already open, its tab is used. In the mark lists, Ctrl/Cmd+click (Ctrl/Cmd+Enter in the search) opens it the other way.',
				control: { type: 'dropdown', key: 'openIn', options: OPEN_IN, defaultValue: DEFAULT_SETTINGS.openIn },
			},
			{
				name: 'Cursor position after jump',
				desc: 'Where to place the cursor on the line after jumping to a mark. "Start of text" skips list markers, checkboxes, heading and quote markers. Other plugins (e.g. Outliner) may move the cursor afterwards. Has no effect in reading mode.',
				control: { type: 'dropdown', key: 'cursorPosition', options: CURSOR_POSITION, defaultValue: DEFAULT_SETTINGS.cursorPosition },
			},
			{
				name: 'Default color',
				desc: 'Color of new marks. It does not change the color of existing marks.',
				control: { type: 'dropdown', key: 'defaultColor', options: { none: 'No color', ...MARK_COLORS }, defaultValue: DEFAULT_SETTINGS.defaultColor },
			},
			{
				name: 'Show marks on scrollbar',
				desc: 'Show where the marks are in the file along the scrollbar of the editor. Click a mark on the scrollbar to jump to it. (On phones and tablets, the marks are only shown.)',
				control: { type: 'toggle', key: 'isShowScrollbarMarks', defaultValue: DEFAULT_SETTINGS.isShowScrollbarMarks },
			},
			{
				name: 'Mark list sort order',
				desc: 'Order of marks in the mark list (search). `Color` sorts by color (no color last), then by label (or line text), file name, and line. The mark list in the sidebar has its own grouping, which you can switch in the sidebar.',
				control: { type: 'dropdown', key: 'listSortOrder', options: LIST_SORT_ORDER, defaultValue: DEFAULT_SETTINGS.listSortOrder },
			},
			{
				name: 'Sidebar grouping',
				desc: 'How to group marks in the mark list in the sidebar. You can also switch it with the button at the top of the sidebar.',
				control: { type: 'dropdown', key: 'sidebarGroupBy', options: SIDEBAR_GROUP_BY, defaultValue: DEFAULT_SETTINGS.sidebarGroupBy },
			},
			{
				name: 'Unmark shortcut',
				desc: 'Shortcut to unmark the selected mark in the mark list. Click the button and press the keys. A modifier key other than Shift is required.',
				aliases: ['hotkey', 'keybinding'],
				render: setting => this.renderUnmarkShortcut(setting),
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		if (key === 'isShowScrollbarMarks') {
			this.plugin.updateEditorExtensions();
		} else if (key === 'sidebarGroupBy') {
			this.plugin.refreshMarkListViews();
		}
	}

	// Records the key combination pressed after clicking the button. Returns a cleanup function for when the setting tab is closed while waiting for keys.
	private renderUnmarkShortcut(setting: Setting): () => void {
		let stopRecording: (() => void) | null = null;
		setting
			.addButton(button => {
				const showShortcut = () => button.setButtonText(formatShortcut(this.plugin.settings.unmarkShortcut, Platform.isMacOS));
				showShortcut();
				button.onClick(() => {
					button.setButtonText('Press keys... (Esc to cancel)');
					const onKeyDown = (event: KeyboardEvent) => {
						event.preventDefault();
						event.stopPropagation();
						if (event.code === 'Escape') {
							finish();
							return;
						}
						const shortcut = shortcutFromEvent(event);
						if (!shortcut) {
							return;
						}
						this.plugin.settings.unmarkShortcut = shortcut;
						void this.plugin.saveSettings();
						finish();
					};
					const finish = () => {
						activeWindow.removeEventListener('keydown', onKeyDown, true);
						stopRecording = null;
						showShortcut();
					};
					stopRecording?.();
					stopRecording = finish;
					activeWindow.addEventListener('keydown', onKeyDown, true);
				});
				setting.addExtraButton(resetButton => resetButton
					.setIcon('reset')
					.setTooltip('Reset to default')
					.onClick(() => {
						stopRecording?.();
						this.plugin.settings.unmarkShortcut = DEFAULT_SETTINGS.unmarkShortcut;
						void this.plugin.saveSettings();
						showShortcut();
					}));
			});
		return () => stopRecording?.();
	}
}
