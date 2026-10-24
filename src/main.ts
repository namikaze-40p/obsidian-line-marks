import { debounce, Editor, editorInfoField, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';

import { DEFAULT_SETTINGS, SettingTab, Settings } from './settings';
import { MarkListModal } from './mark-list-modal';
import { MARK_LIST_VIEW_TYPE, MarkListView } from './mark-list-view';
import { collectLabels, confirmUnmarkAll, confirmUnmarkFile, pluralize } from './mark-list-actions';
import { helpers } from './helper';
import { MarkStore } from './mark-store';
import { createMarkExtension, editMark, findMark, toggleMark } from './mark-extension';
import { EditMarkModal } from './edit-mark-modal';
import { pickMeta } from './mark-restore';
import { createScrollbarMarks } from './scrollbar-marks';
import { findCursorCh } from './cursor-position';
import { FLASH_DURATION, flashField, flashLine } from './flash-line';
import { centerWidget, waitForElement } from './block-widget';
import { MarkColor, MarkMeta, SavedMark } from './type';

const getEditorView = (editor: Editor): EditorView => (editor as Editor & { cm: EditorView }).cm;

// `current` is the current position (1-based line number). `moveTo` moves to the given line (1-based).
type JumpPosition = { file: TFile | null, current: number, moveTo: (line: number) => void };

// Which marks to jump to. `color` is the color of the marks to go through (undefined for marks with no color); null jumps to any mark.
type JumpFilter = { color: MarkColor | undefined } | null;

// The mark last jumped to, identified by when it was marked, which does not change while editing (unlike the line).
type JumpedMark = { path: string, createdAt: number };

// The line (0-based) last jumped to in reading mode.
type PreviewJump = { view: MarkdownView, path: string | null, line: number };

// The line (0-based) last jumped to in editing mode, and the line where the cursor actually ended up.
// When the cursor cannot be placed on the target line (e.g. the frontmatter in Live Preview, hidden by the properties), it is moved to another line.
type EditorJump = { editorView: EditorView, path: string | null, line: number, cursorLine: number };

// These events mean that the user scrolled (or moved the cursor, or edited) manually.
const MANUAL_SCROLL_EVENTS = ['wheel', 'touchmove', 'pointerdown'] as const;

export default class LineMarks extends Plugin {
	// Initialized in onload.
	settings!: Settings;
	settingTab!: SettingTab;
	store!: MarkStore;

	// Its contents are replaced depending on the settings, and applied with updateOptions.
	private editorExtensions: Extension[] = [];
	private markExtension!: Extension;
	private scrollbarMarks!: Extension;
	private lastPreviewJump: PreviewJump | null = null;
	private lastEditorJump: EditorJump | null = null;
	// The mark last jumped to (from any jump: the commands, the mark lists, and the scrollbar), for jumping to marks with the same color.
	// Kept only while the plugin is running, not saved to data.json: it is soon out of date, and saving on every jump could cause conflicts with sync services.
	private lastJumpedMark: JumpedMark | null = null;
	// Timers of the elements highlighted by this plugin, so that an earlier timer does not remove a newer highlight when jumping repeatedly.
	private elementFlashTimers = new WeakMap<HTMLElement, number>();
	// Views that already have the listeners for detecting manual scrolling.
	private watchedPreviewViews = new WeakSet<MarkdownView>();

	private requestSave = debounce(() => this.saveSettings(), 1000, true);

	async onload() {
		await this.loadSettings();
		this.store = new MarkStore(this.settings.files, () => this.requestSave());

		this.registerView(MARK_LIST_VIEW_TYPE, leaf => new MarkListView(leaf, this.store, this.settings, () => this.onSettingsChangedOutside(), (path, line, isOtherWay) => this.openMark(path, line, isOtherWay)));

		this.addRibbonIcon('bookmark', 'Open mark list in sidebar', () => void this.openMarkListView());

		this.addCommand({
			id: 'toggle-mark-state',
			name: 'Toggle mark state',
			editorCallback: (editor: Editor) => this.toggleMark(editor),
		});

		this.addCommand({
			id: 'edit-mark',
			name: 'Edit label and color',
			editorCallback: (editor: Editor) => {
				const view = getEditorView(editor);
				this.editMark(view, view.state.selection.main.head);
			},
		});

		this.addCommand({
			id: 'jump-to-previous-mark',
			name: 'Jump to previous mark',
			checkCallback: (checking: boolean) => this.runJumpCommand(checking, false),
		});

		this.addCommand({
			id: 'jump-to-next-mark',
			name: 'Jump to next mark',
			checkCallback: (checking: boolean) => this.runJumpCommand(checking, true),
		});

		this.addCommand({
			id: 'jump-to-previous-mark-with-same-color',
			name: 'Jump to previous mark with the same color',
			checkCallback: (checking: boolean) => this.runJumpCommand(checking, false, true),
		});

		this.addCommand({
			id: 'jump-to-next-mark-with-same-color',
			name: 'Jump to next mark with the same color',
			checkCallback: (checking: boolean) => this.runJumpCommand(checking, true, true),
		});

		this.addCommand({
			id: 'unmark-all-in-current-file',
			name: 'Unmark all in current file',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.store.get(file.path).length) {
					return false;
				}
				if (!checking) {
					confirmUnmarkFile(this.app, this.store, file.path);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'unmark-all-in-vault',
			name: 'Unmark all in vault',
			checkCallback: (checking: boolean) => {
				if (!this.store.paths().length) {
					return false;
				}
				if (!checking) {
					confirmUnmarkAll(this.app, this.store);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'remove-marks-of-missing-files',
			name: 'Remove marks of missing files',
			callback: () => this.removeMarksOfMissingFiles(),
		});

		this.addCommand({
			id: 'open-mark-list',
			name: 'Open mark list',
			callback: () => this.openMarkList(),
		});

		this.addCommand({
			id: 'open-mark-list-in-sidebar',
			name: 'Open mark list in sidebar',
			callback: () => void this.openMarkListView(),
		});

		this.settingTab = new SettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onFileRename(file, oldPath)));
		// Do not keep holding the view of a closed tab.
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			if (this.lastPreviewJump && !this.lastPreviewJump.view.containerEl.isConnected) {
				this.lastPreviewJump = null;
			}
		}));
		this.registerEvent(this.app.vault.on('delete', file => this.onFileDelete(file)));

		this.markExtension = createMarkExtension(this.store, {
			onGutterMenu: (view, pos, event) => this.showGutterMenu(view, pos, event),
			getDefaultMeta: () => this.getDefaultMeta(),
		});
		this.scrollbarMarks = createScrollbarMarks({
			findCursorOffset: (view, lineFrom) => {
				const line = view.state.doc.lineAt(lineFrom);
				return line.from + this.findCursorCh(view.state.field(editorInfoField, false)?.file ?? null, line.number - 1, line.text);
			},
			onJump: (view, mark) => {
				const path = view.state.field(editorInfoField, false)?.file?.path;
				this.lastJumpedMark = path ? { path, createdAt: mark.createdAt } : null;
			},
		});
		this.updateEditorExtensions();
		this.registerEditorExtension(this.editorExtensions);
	}

	onunload(): void {
		void this.requestSave.run();
	}

	// Called when a setting is changed outside the setting tab (e.g. the toolbar in the sidebar). Rebuilds the setting tab so that an open one does not show stale values.
	private onSettingsChangedOutside(): void {
		this.requestSave();
		this.settingTab.update();
	}

	refreshMarkListViews(): void {
		this.app.workspace.getLeavesOfType(MARK_LIST_VIEW_TYPE).forEach(leaf => {
			if (leaf.view instanceof MarkListView) {
				leaf.view.renderNow();
			}
		});
	}

	updateEditorExtensions(): void {
		this.editorExtensions.length = 0;
		this.editorExtensions.push(this.markExtension, flashField);
		if (this.settings.isShowScrollbarMarks) {
			this.editorExtensions.push(this.scrollbarMarks);
		}
		this.app.workspace.updateOptions();
	}

	async loadSettings(): Promise<void> {
		const loadData = await this.loadData() as Partial<Settings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadData,
			files: loadData?.files || {},
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private openMarkList(): void {
		new MarkListModal(this.app, this.settings, this.store, (path, line, isOtherWay) => this.openMark(path, line, isOtherWay)).open();
	}

	// Reveals the view if it is already open, or opens it in the right sidebar.
	private async openMarkListView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(MARK_LIST_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) {
				return;
			}
			await rightLeaf.setViewState({ type: MARK_LIST_VIEW_TYPE, active: true });
			leaf = rightLeaf;
		}
		await workspace.revealLeaf(leaf);
	}

	private onFileRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFile) {
			this.store.rename(oldPath, file.path);
			if (this.lastJumpedMark?.path === oldPath) {
				this.lastJumpedMark = { ...this.lastJumpedMark, path: file.path };
			}
		}
	}

	private onFileDelete(file: TAbstractFile): void {
		if (file instanceof TFile) {
			this.store.delete(file.path);
		}
	}

	// Removes the marks of files renamed or deleted outside Obsidian. Not done automatically, so that valid marks are not removed while a sync service is still catching up.
	private removeMarksOfMissingFiles(): void {
		const paths = this.store.paths().filter(path => !(this.app.vault.getAbstractFileByPath(path) instanceof TFile));
		if (!paths.length) {
			new Notice('No marks of missing files.');
			return;
		}
		const count = paths.reduce((acc, path) => acc + this.store.get(path).length, 0);
		paths.forEach(path => this.store.delete(path));
		new Notice(`Removed ${pluralize(count, 'mark')} of ${pluralize(paths.length, 'missing file')}.`);
	}

	private toggleMark(editor: Editor): void {
		const view = getEditorView(editor);
		toggleMark(view, view.state.selection.main.head, this.getDefaultMeta());
	}

	private getDefaultMeta(): MarkMeta {
		const { defaultColor } = this.settings;
		return defaultColor === 'none' ? {} : { color: defaultColor };
	}

	// On a line without a mark, the line is marked when saved.
	private editMark(view: EditorView, pos: number): void {
		const mark = findMark(view.state, pos);
		new EditMarkModal(this.app, mark ? pickMeta(mark) : this.getDefaultMeta(), collectLabels(this.store), meta => editMark(view, pos, meta)).open();
	}

	private showGutterMenu(view: EditorView, pos: number, event: MouseEvent): void {
		const isMarked = !!findMark(view.state, pos);
		const menu = new Menu();
		// Same order as the menu in the sidebar: edit first, then mark / unmark.
		menu.addItem(item => item
			.setTitle('Edit label and color')
			.setIcon('pencil')
			.onClick(() => this.editMark(view, pos)));
		menu.addItem(item => item
			.setTitle(isMarked ? 'Unmark' : 'Mark')
			.setIcon(isMarked ? 'bookmark-x' : 'bookmark-plus')
			.onClick(() => toggleMark(view, pos, this.getDefaultMeta())));
		menu.showAtMouseEvent(event);
	}

	// Available in reading mode as well as in editors (editorCallback is not available in reading mode).
	// When no file is open, or a non-Markdown file is open (there is no current position),
	// jumps to the mark in the first (or last, when going back) file, if jumping across files is allowed.
	// `isSameColor` limits the marks to those with the same color as the base mark (see findSameColorFilter).
	private runJumpCommand(checking: boolean, isNext: boolean, isSameColor = false): boolean {
		const position = this.getJumpPosition();
		if (!position && !this.canJumpToOtherFile()) {
			return false;
		}
		if (!checking) {
			const filter = isSameColor ? this.findSameColorFilter(position) : null;
			void (position ? this.jumpToMark(position, isNext, filter) : this.jumpToOtherFile(null, isNext, filter));
		}
		return true;
	}

	// The base mark is the mark on the current line, or else the mark last jumped to. Marks with no color go through marks with no color.
	// When there is neither, jumps to any mark, and the mark jumped to becomes the base of the next jump.
	private findSameColorFilter(position: JumpPosition | null): JumpFilter {
		const currentMark = position?.file ? this.store.get(position.file.path).find(({ line }) => line === position.current) : undefined;
		const jumped = this.lastJumpedMark;
		const baseMark = currentMark ?? (jumped ? this.store.get(jumped.path).find(({ createdAt }) => createdAt === jumped.createdAt) : undefined);
		return baseMark ? { color: baseMark.color } : null;
	}

	private canJumpToOtherFile(): boolean {
		return this.settings.isAllowCrossFile && this.store.paths().some(path => this.app.vault.getAbstractFileByPath(path) instanceof TFile);
	}

	private findJumpTargets(path: string, filter: JumpFilter): SavedMark[] {
		const marks = this.store.get(path);
		return filter ? marks.filter(({ color }) => color === filter.color) : marks;
	}

	private recordJumpedMark(path: string, line: number): void {
		const mark = this.store.get(path).find(mark => mark.line === line);
		this.lastJumpedMark = mark ? { path, createdAt: mark.createdAt } : null;
	}

	// The current file, the current position (1-based line number, which can be fractional in reading mode), and a function to move to a given line.
	private getJumpPosition(): JumpPosition | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const { activeEditor } = this.app.workspace;
		// Prefer an editor other than the reading-mode tab (e.g. a hover editor) when the user is editing in it.
		const isEditingElsewhere = !!activeEditor?.editor && activeEditor !== view;
		if (view?.getMode() === 'preview' && !isEditingElsewhere) {
			return { file: view.file, current: this.getPreviewLine(view) + 1, moveTo: line => this.scrollPreview(view, line - 1) };
		}
		const editor = activeEditor?.editor;
		if (!editor) {
			return null;
		}
		const { file } = activeEditor;
		return { file, current: this.getEditorLine(editor, file) + 1, moveTo: line => this.moveCursor(editor, line - 1, file) };
	}

	// The current position (0-based) in editing mode: the line of the cursor.
	// However, when a jump moved the cursor to another line, the next jump would go back to the same mark.
	// So if the cursor has not moved since then, the line jumped to is used as the current position.
	private getEditorLine(editor: Editor, file: TFile | null): number {
		const cursorLine = editor.getCursor().line;
		const jump = this.lastEditorJump;
		if (jump?.editorView === getEditorView(editor) && jump.path === (file?.path ?? null) && jump.cursorLine === cursorLine) {
			return jump.line;
		}
		return cursorLine;
	}

	private async jumpToMark({ file, current, moveTo }: JumpPosition, isNext: boolean, filter: JumpFilter = null): Promise<void> {
		const lines = file ? this.findJumpTargets(file.path, filter).map(({ line }) => line) : [];
		const jumpTo = (line: number) => {
			moveTo(line);
			if (file) {
				this.recordJumpedMark(file.path, line);
			}
		};
		const line = isNext
			? lines.find(line => line > current)
			: [...lines].reverse().find(line => line < current);
		if (line) {
			jumpTo(line);
			return;
		}

		if (!this.settings.isAllowCrossFile) {
			// Wrap around to the first (or last) mark in the file.
			if (lines.length) {
				jumpTo(isNext ? lines[0] : lines[lines.length - 1]);
			}
			return;
		}
		await this.jumpToOtherFile(file, isNext, filter);
	}

	// The current position (0-based) in reading mode: the line shown at the top of the screen.
	// However, reading mode scrolls by block, so after jumping to a line in the middle of a paragraph, the top of the screen is before the line jumped to.
	// The next jump would then go back to the same mark, so if the user has not interacted since the jump, the line jumped to is used as the current position.
	private getPreviewLine(view: MarkdownView): number {
		const jump = this.lastPreviewJump;
		if (jump?.view === view && jump.path === view.file?.path) {
			return jump.line;
		}
		return view.previewMode.getScroll();
	}

	// Passes the line to show and lets Obsidian scroll to it. Unlike applyScroll, the target block is highlighted for a while
	// (the same as when opened from another file). It is applied once the view is ready, even if called before that.
	private scrollPreview(view: MarkdownView, line: number): void {
		const container = view.previewMode.containerEl;
		// Remove the highlight of the previous jump first, so that it is not the one centered.
		container.findAll('.is-flashing').forEach(el => el.removeClass('is-flashing'));
		this.recordPreviewJump(view, line);

		// Lines in the frontmatter are shown as the properties, and setEphemeralState cannot map them to the right position
		// (it scrolls to a wrong position while rendering). Obsidian does not highlight the properties either.
		// So scroll to the top, and once the properties are rendered, scroll to them and highlight them (the same as in editing mode).
		if (this.isInFrontmatter(view.file, line)) {
			view.previewMode.applyScroll(0);
			waitForElement(() => this.findPropertiesEl(container, view.file, line), propertiesEl => {
				propertiesEl.scrollIntoView({ block: 'start' });
				this.flashElement(propertiesEl);
			});
			return;
		}

		view.setEphemeralState({ line });
		// Obsidian shows the target block at the top of the screen, so center it once it is highlighted (the same as in editing mode).
		// Blocks taller than the screen stay at the top, so that their beginning is not hidden.
		waitForElement(() => container.find('.is-flashing'), blockEl => {
			const scroller = blockEl.closest('.markdown-preview-view') ?? container;
			if (blockEl.getBoundingClientRect().height < scroller.clientHeight) {
				blockEl.scrollIntoView({ block: 'center' });
			}
		});
	}

	private flashElement(el: HTMLElement): void {
		window.clearTimeout(this.elementFlashTimers.get(el));
		el.addClass('is-flashing');
		this.elementFlashTimers.set(el, window.setTimeout(() => el.removeClass('is-flashing'), FLASH_DURATION));
	}

	private recordPreviewJump(view: MarkdownView, line: number): void {
		this.lastPreviewJump = { view, path: view.file?.path ?? null, line };
		this.watchManualScroll(view);
	}

	// Forget the remembered jump when the user scrolls manually. It is detected from user input rather than by comparing scroll positions,
	// because when rendering is slow, there is no telling when the scrolling caused by the jump ends.
	// Scrolling, cursor moves, and edits in editing mode happen in the same view, so a stale position is not used after switching modes and back either.
	// The listeners are registered on the view, so they are removed when the tab is closed.
	private watchManualScroll(view: MarkdownView): void {
		if (this.watchedPreviewViews.has(view)) {
			return;
		}
		this.watchedPreviewViews.add(view);
		const forget = () => {
			if (this.lastPreviewJump?.view === view) {
				this.lastPreviewJump = null;
			}
		};
		MANUAL_SCROLL_EVENTS.forEach(type => view.registerDomEvent(view.containerEl, type, forget, { capture: true, passive: true }));
		// Keep it on hotkeys with modifiers (jumping, switching modes), but forget it on scrolling keys and typing.
		view.registerDomEvent(view.containerEl, 'keydown', event => {
			if (!event.ctrlKey && !event.metaKey && !event.altKey) {
				forget();
			}
		}, { capture: true });
	}

	// The current file is included, so that when no other file has marks to jump to, it wraps around to the first (or last) mark in the current file.
	private async jumpToOtherFile(file: TFile | null, isNext: boolean, filter: JumpFilter = null): Promise<void> {
		const paths = this.store.paths().filter(path => this.app.vault.getAbstractFileByPath(path) instanceof TFile && (path === file?.path || this.findJumpTargets(path, filter).length));
		if (!paths.length) {
			return;
		}
		const index = file ? paths.indexOf(file.path) : -1;
		const nextIndex = index < 0
			? (isNext ? 0 : paths.length - 1)
			: (index + (isNext ? 1 : -1) + paths.length) % paths.length;
		const nextPath = paths[nextIndex];
		const lines = this.findJumpTargets(nextPath, filter).map(({ line }) => line);
		if (!lines.length) {
			return;
		}
		await this.openMark(nextPath, isNext ? lines[0] : lines[lines.length - 1]);
	}

	// Opens the file (in its tab if already open) and moves the cursor to the given line (scrolls to it in reading mode).
	// `isOtherWay` is true when the mark was chosen in a mark list with Ctrl/Cmd held. Opens the file the other way from the "Open in" setting.
	private async openMark(path: string, line: number, isOtherWay = false): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return;
		}
		this.recordJumpedMark(path, line);

		const existingLeaf = helpers.getExistingLeaf(this.app, path);
		const isNewTab = (this.settings.openIn === 'new') !== isOtherWay;
		// getLeaf(false) uses the current tab, or opens a new tab if the current tab is pinned.
		const leaf = existingLeaf ?? this.app.workspace.getLeaf(isNewTab ? 'tab' : false);
		if (!existingLeaf) {
			// Do not pass the line in eState: in editing mode, Obsidian adds a highlight that stays until the user clicks.
			await leaf.openFile(file);
		}
		// When opened from the sidebar, the tab may not become active, so activate it explicitly.
		// Skip it if the tab is already active, because focusing it again can restore its previous scroll position.
		if (this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf !== leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		}

		// Use the view of the opened tab, because looking up the active view fails before the tab becomes active (while the sidebar is still active).
		const { view } = leaf;
		if (!(view instanceof MarkdownView)) {
			return;
		}
		// In reading mode, moving the cursor does not scroll the view, so scroll to the line.
		// For a tab that was in the background or has just been opened, applyScroll right away has no effect because the view is not ready,
		// so use scrollPreview (applied once the view is ready).
		if (view.getMode() === 'preview') {
			this.scrollPreview(view, line - 1);
			return;
		}
		this.moveCursor(view.editor, line - 1, view.file);
	}

	// Moves the cursor, and highlights the target line for a while (the same as in reading mode). `line` is 0-based.
	// A saved line number can exceed the line count if the file was shortened outside Obsidian, so clamp it.
	private moveCursor(editor: Editor, line: number, file: TFile | null): void {
		const target = Math.min(line, editor.lastLine());
		const pos = { line: target, ch: this.findCursorCh(file, target, editor.getLine(target)) };
		const editorView = getEditorView(editor);
		// Focus before moving the cursor: in Live Preview, a table opens the editor of the cell only when the editor has focus as the cursor moves into it.
		// (When jumping from the sidebar, the sidebar still has focus.)
		editorView.focus();
		helpers.setCursor(editor, pos);
		// Do not rely only on the scrolling caused by the cursor move: show the target line in the center of the screen.
		// Scroll to the cursor rather than the start of the line, so that the cursor at the end of a long wrapped line is also shown.
		editor.scrollIntoView({ from: pos, to: pos }, true);
		const cursorLine = editor.getCursor().line;
		this.lastEditorJump = cursorLine === target ? null : { editorView, path: file?.path ?? null, line: target, cursorLine };
		const lineFrom = editor.posToOffset({ line: target, ch: 0 });
		// The properties (the frontmatter in Live Preview) are highlighted instead, and keep the scrolling as before.
		if (!this.isInFrontmatter(file, target)) {
			centerWidget(editorView, lineFrom);
		}
		flashLine(editorView, lineFrom, () => {
			const sourceViewEl = editorView.dom.closest<HTMLElement>('.markdown-source-view');
			return sourceViewEl ? this.findPropertiesEl(sourceViewEl, file, target) : null;
		});
	}

	// The column to place the cursor at on the line (0-based) after a jump, depending on the "Cursor position after jump" setting.
	private findCursorCh(file: TFile | null, line: number, text: string): number {
		const { cursorPosition } = this.settings;
		return cursorPosition === 'lineStart' ? 0 : findCursorCh(text, cursorPosition, helpers.findLineBlock(this.app, file, line));
	}

	// When jumping to a line in the frontmatter in Live Preview or reading mode, the line is shown as the properties,
	// so highlight the properties instead. `containerEl` is the editor or the reading view. Returns null in Source mode, where the properties are not shown.
	private findPropertiesEl(containerEl: HTMLElement, file: TFile | null, line: number): HTMLElement | null {
		if (!this.isInFrontmatter(file, line)) {
			return null;
		}
		const propertiesEl = containerEl.find('.metadata-container');
		return propertiesEl?.isShown() ? propertiesEl : null;
	}

	// `line` is 0-based.
	private isInFrontmatter(file: TFile | null, line: number): boolean {
		const position = file ? this.app.metadataCache.getFileCache(file)?.frontmatterPosition : undefined;
		return !!position && position.start.line <= line && line <= position.end.line;
	}
}
