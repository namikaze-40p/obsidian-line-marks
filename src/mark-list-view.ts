import { debounce, ItemView, Keymap, Menu, Platform, setIcon, setTooltip, WorkspaceLeaf } from 'obsidian';
import { MarkStore } from './mark-store';
import { groupMarkListItems, groupMarkListItemsByColor, MarkListColorGroup, MarkListGroup, MarkListGroupBy, MarkListItem } from './mark-list';
import { colorClass, MARK_COLORS } from './color';
import { confirmUnmarkAll, confirmUnmarkFile, displayText, editMarkItem, loadMarkListItems, MISSING_FILE_TOOLTIP, noticeMissingFile, unmarkItem } from './mark-list-actions';
import { Settings } from './settings';

export const MARK_LIST_VIEW_TYPE = 'line-marks-list';

// Render after editing settles down, instead of on every keystroke.
const RENDER_DELAY = 300;

const GROUP_BY_OPTIONS: [MarkListGroupBy, string][] = [['file', 'Group by file'], ['color', 'Group by color']];

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

const folderPath = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

// Keys for remembering which groups are collapsed, separately for each grouping.
const fileKey = (path: string): string => `file:${path}`;
const colorKey = (color: string | undefined): string => `color:${color ?? 'none'}`;

type GroupOptions = {
	key: string,
	count: number,
	renderTitle: (inner: HTMLElement) => void,
	tooltip: string,
	isMissing?: boolean,
	createMenu?: () => Menu,
};

// The mark list kept open in the right sidebar. Searching is left to the modal; this view focuses on listing marks by file (or by color).
export class MarkListView extends ItemView {
	// Keys of collapsed groups.
	private collapsedKeys = new Set<string>();
	// Key -> group element. Used to toggle collapsing and the highlight of the open file without re-rendering.
	private groupEls = new Map<string, HTMLElement>();
	private listEl!: HTMLElement;
	private collapseButton!: HTMLElement;
	private requestRender = debounce(() => this.render(), RENDER_DELAY, true);

	constructor(
		leaf: WorkspaceLeaf,
		private store: MarkStore,
		private settings: Settings,
		// Saves the settings and refreshes the setting tab.
		private onSettingsChanged: () => void,
		private openMark: (path: string, line: number, isOtherWay: boolean) => Promise<void>,
	) {
		super(leaf);
	}

	getViewType(): string {
		return MARK_LIST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Line marks';
	}

	getIcon(): string {
		return 'bookmark';
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('line-marks-view');
		this.renderToolbar();
		this.listEl = this.contentEl.createDiv({ cls: 'line-marks-view-list' });
		this.register(this.store.onChange(() => this.requestRender()));
		// A missing file may be created again.
		this.registerEvent(this.app.vault.on('create', () => this.requestRender()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.updateActiveFile()));
		this.render();
		return Promise.resolve();
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem(item => item
			.setTitle('Unmark all in vault')
			.setIcon('bookmark-x')
			.setWarning(true)
			.onClick(() => confirmUnmarkAll(this.app, this.store)));
	}

	onClose(): Promise<void> {
		this.requestRender.cancel();
		return Promise.resolve();
	}

	// Buttons at the top, in the same style as the file explorer and other views.
	private renderToolbar(): void {
		const buttons = this.contentEl.createDiv({ cls: 'nav-header' }).createDiv({ cls: 'nav-buttons-container' });

		const groupByButton = buttons.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': 'Change grouping' } });
		setIcon(groupByButton, 'layers');
		groupByButton.addEventListener('click', event => {
			const menu = new Menu();
			GROUP_BY_OPTIONS.forEach(([groupBy, title]) => menu.addItem(item => item
				.setTitle(title)
				.setChecked(this.settings.sidebarGroupBy === groupBy)
				.onClick(() => this.setGroupBy(groupBy))));
			menu.showAtMouseEvent(event);
		});

		this.collapseButton = buttons.createDiv({ cls: 'clickable-icon nav-action-button' });
		this.collapseButton.addEventListener('click', () => this.toggleCollapseAll());
	}

	private setGroupBy(groupBy: MarkListGroupBy): void {
		this.settings.sidebarGroupBy = groupBy;
		this.onSettingsChanged();
		this.renderNow();
	}

	private render(): void {
		const { listEl } = this;
		const { scrollTop } = listEl;
		listEl.empty();
		this.groupEls.clear();

		const items = loadMarkListItems(this.app, this.store);
		if (!items.length) {
			listEl.createDiv({ cls: 'pane-empty', text: 'No marks yet. Mark a line with the "Toggle mark state" command, or by clicking the gutter.' });
		} else if (this.settings.sidebarGroupBy === 'color') {
			groupMarkListItemsByColor(items).forEach(group => this.renderColorGroup(group));
		} else {
			groupMarkListItems(items).forEach(group => this.renderFileGroup(group));
		}
		this.updateActiveFile();
		this.updateCollapseButton();
		listEl.scrollTop = scrollTop;
	}

	private renderFileGroup({ path, isMissing, items }: MarkListGroup): void {
		const children = this.renderGroup({
			key: fileKey(path),
			count: items.length,
			renderTitle: inner => {
				inner.createSpan({ cls: 'line-marks-view-group-name', text: fileName(path) });
				const folder = folderPath(path);
				if (folder) {
					inner.createSpan({ cls: 'line-marks-view-folder', text: folder });
				}
				if (isMissing) {
					setIcon(inner.createSpan({ cls: 'line-marks-missing-icon' }), 'alert-triangle');
				}
			},
			tooltip: isMissing ? `${path}\n${MISSING_FILE_TOOLTIP}` : path,
			isMissing,
			createMenu: () => {
				const menu = new Menu();
				menu.addItem(item => item
					.setTitle('Unmark all in this file')
					.setIcon('bookmark-x')
					.setWarning(true)
					.onClick(() => confirmUnmarkFile(this.app, this.store, path, () => this.renderNow())));
				return menu;
			},
		});
		items.forEach(item => this.renderItem(children, item, false));
	}

	private renderColorGroup({ color, items }: MarkListColorGroup): void {
		const name = color ? MARK_COLORS[color] ?? color : 'No color';
		const children = this.renderGroup({
			key: colorKey(color),
			count: items.length,
			renderTitle: inner => {
				inner.createSpan({ cls: `line-marks-color-dot ${colorClass(color)}` });
				inner.createSpan({ cls: 'line-marks-view-group-name', text: name });
			},
			tooltip: name,
		});
		items.forEach(item => this.renderItem(children, item, true));
	}

	// Renders the group header and returns the element to put the marks in.
	private renderGroup({ key, count, renderTitle, tooltip, isMissing = false, createMenu }: GroupOptions): HTMLElement {
		const groupEl = this.listEl.createDiv({ cls: 'tree-item line-marks-view-group' });
		groupEl.toggleClass('is-collapsed', this.collapsedKeys.has(key));
		groupEl.toggleClass('is-missing', isMissing);
		this.groupEls.set(key, groupEl);

		const self = groupEl.createDiv({ cls: 'tree-item-self is-clickable mod-collapsible' });
		setIcon(self.createDiv({ cls: 'tree-item-icon collapse-icon' }), 'right-triangle');
		renderTitle(self.createDiv({ cls: 'tree-item-inner' }));
		setTooltip(self, tooltip);
		self.createDiv({ cls: 'tree-item-flair-outer' }).createSpan({ cls: 'tree-item-flair', text: String(count) });
		self.addEventListener('click', () => this.toggleCollapsed(key));
		if (createMenu) {
			this.addMenu(self, createMenu);
		}
		return groupEl.createDiv({ cls: 'tree-item-children' });
	}

	// `showLocation` is true when grouped by color. Shows the file name and line below the text, instead of the line number.
	private renderItem(parent: HTMLElement, item: MarkListItem, showLocation: boolean): void {
		const itemEl = parent.createDiv({ cls: 'tree-item-self is-clickable line-marks-view-mark' });
		itemEl.toggleClass('is-missing', item.isMissing);
		if (!showLocation) {
			itemEl.createSpan({ cls: 'line-marks-view-line', text: String(item.line) });
		}
		const content = itemEl.createDiv({ cls: 'line-marks-view-mark-content' });
		const title = content.createDiv({ cls: 'line-marks-view-mark-title' });
		title.createSpan({ cls: `line-marks-color-dot ${colorClass(item.color)}` });
		if (item.label) {
			title.createSpan({ cls: 'line-marks-view-label', text: item.label });
			content.createDiv({ cls: 'line-marks-view-text mod-sub', text: displayText(item.text) });
		} else {
			title.createSpan({ cls: 'line-marks-view-text', text: displayText(item.text) });
		}
		if (showLocation) {
			const location = content.createDiv({ cls: 'line-marks-view-location', text: `${fileName(item.path)}:${item.line}` });
			if (item.isMissing) {
				setIcon(location.createSpan({ cls: 'line-marks-missing-icon' }), 'alert-triangle');
			}
			setTooltip(location, item.isMissing ? `${item.path}\n${MISSING_FILE_TOOLTIP}` : item.path);
		}
		itemEl.addEventListener('click', event => {
			if (item.isMissing) {
				noticeMissingFile();
				return;
			}
			// Ctrl/Cmd+click (or middle click) opens the file the other way from the setting.
			void this.openMark(item.path, item.line, !!Keymap.isModEvent(event));
		});

		this.addMenu(itemEl, () => {
			const menu = new Menu();
			menu.addItem(menuItem => menuItem
				.setTitle('Edit label and color')
				.setIcon('pencil')
				.onClick(() => editMarkItem(this.app, this.store, item, () => this.renderNow())));
			menu.addItem(menuItem => menuItem
				.setTitle('Unmark')
				.setIcon('bookmark-x')
				.onClick(() => {
					unmarkItem(this.store, item);
					this.renderNow();
				}));
			return menu;
		});

		// Touch devices cannot right-click, so a ⋯ menu button is placed instead.
		if (Platform.isMobile) {
			return;
		}
		const button = itemEl.createDiv({ cls: 'line-marks-unmark-button clickable-icon', attr: { 'aria-label': 'Unmark' } });
		setIcon(button, 'x');
		button.addEventListener('click', event => {
			event.stopPropagation();
			unmarkItem(this.store, item);
			this.renderNow();
		});
	}

	// Opens the menu on right-click. Touch devices cannot right-click, so a ⋯ button is placed at the right end of the row to open it on tap.
	private addMenu(el: HTMLElement, createMenu: () => Menu): void {
		el.addEventListener('contextmenu', event => {
			event.preventDefault();
			createMenu().showAtMouseEvent(event);
		});
		if (!Platform.isMobile) {
			return;
		}
		const button = el.createDiv({ cls: 'line-marks-more-button clickable-icon', attr: { 'aria-label': 'More options' } });
		setIcon(button, 'more-horizontal');
		button.addEventListener('click', event => {
			// Do not trigger the click on the row (jumping / collapsing).
			event.stopPropagation();
			createMenu().showAtMouseEvent(event);
		});
	}

	// Applies unmarked marks and setting changes right away, without the delay.
	renderNow(): void {
		this.requestRender.cancel();
		this.render();
	}

	private toggleCollapsed(key: string): void {
		if (this.collapsedKeys.has(key)) {
			this.collapsedKeys.delete(key);
		} else {
			this.collapsedKeys.add(key);
		}
		this.groupEls.get(key)?.toggleClass('is-collapsed', this.collapsedKeys.has(key));
		this.updateCollapseButton();
	}

	private isAllCollapsed(): boolean {
		return this.groupEls.size > 0 && [...this.groupEls.keys()].every(key => this.collapsedKeys.has(key));
	}

	// Expands all groups if all are collapsed, otherwise collapses all.
	private toggleCollapseAll(): void {
		const isCollapsing = !this.isAllCollapsed();
		this.groupEls.forEach((el, key) => {
			if (isCollapsing) {
				this.collapsedKeys.add(key);
			} else {
				this.collapsedKeys.delete(key);
			}
			el.toggleClass('is-collapsed', isCollapsing);
		});
		this.updateCollapseButton();
	}

	private updateCollapseButton(): void {
		const isAllCollapsed = this.isAllCollapsed();
		setIcon(this.collapseButton, isAllCollapsed ? 'chevrons-up-down' : 'chevrons-down-up');
		this.collapseButton.setAttribute('aria-label', isAllCollapsed ? 'Expand all' : 'Collapse all');
	}

	private updateActiveFile(): void {
		const activePath = this.app.workspace.getActiveFile()?.path;
		this.groupEls.forEach((el, key) => el.toggleClass('is-active', !!activePath && key === fileKey(activePath)));
	}
}
