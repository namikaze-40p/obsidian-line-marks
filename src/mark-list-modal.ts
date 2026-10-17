import { App, Keymap, Platform, prepareFuzzySearch, setIcon, setTooltip, SuggestModal } from 'obsidian';
import { MarkStore } from './mark-store';
import { MarkListItem, sortMarkListItems } from './mark-list';
import { displayText, loadMarkListItems, MISSING_FILE_TOOLTIP, noticeMissingFile, unmarkItem } from './mark-list-actions';
import { Settings } from './settings';
import { colorClass } from './color';
import { formatShortcut, matchesShortcut } from './shortcut';

// A private property of SuggestModal. Used to apply shortcuts to the selected item.
type Chooser = { selectedItem: number, values: MarkListItem[] | null, setSelectedItem(index: number, event?: Event): void };

export class MarkListModal extends SuggestModal<MarkListItem> {
	private items: MarkListItem[] = [];

	constructor(
		app: App,
		private settings: Settings,
		private store: MarkStore,
		private openMark: (path: string, line: number, isOtherWay: boolean) => Promise<void>,
	) {
		super(app);
		this.modalEl.addClass('line-marks-modal');
		this.setPlaceholder('Search marks...');
		this.emptyStateText = 'No marks found.';
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to jump' },
			{ command: Platform.isMacOS ? '⌘ ↵' : 'ctrl ↵', purpose: settings.openIn === 'new' ? 'to jump in current tab' : 'to jump in new tab' },
			{ command: formatShortcut(settings.unmarkShortcut, Platform.isMacOS), purpose: 'to unmark' },
			{ command: 'esc', purpose: 'to dismiss' },
		]);
		// Ctrl/Cmd+Enter opens the file the other way from the setting (SuggestModal handles only Enter without modifiers).
		this.scope.register(['Mod'], 'Enter', event => {
			const { selectedItem, values } = this.getChooser();
			const item = values?.[selectedItem];
			if (item) {
				this.selectSuggestion(item, event);
			}
			return false;
		});
		this.inputEl.addEventListener('keydown', event => {
			if (!matchesShortcut(event, this.settings.unmarkShortcut)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const { selectedItem, values } = this.getChooser();
			const item = values?.[selectedItem];
			if (item) {
				this.unmark(item);
			}
		});
	}

	onOpen(): void {
		// super.onOpen() renders the suggestions, so load the list first.
		this.items = loadMarkListItems(this.app, this.store);
		void super.onOpen();
	}

	getSuggestions(query: string): MarkListItem[] {
		const items = sortMarkListItems(this.items, this.settings.listSortOrder);
		if (!query) {
			return items;
		}
		const search = prepareFuzzySearch(query);
		return items.filter(item => search(`${item.label ?? ''} ${item.text} ${item.path}`));
	}

	renderSuggestion(item: MarkListItem, el: HTMLElement): void {
		el.addClass('line-marks-suggestion');
		const content = el.createDiv({ cls: 'line-marks-suggestion-content' });
		const title = content.createDiv({ cls: 'suggestion-title' });
		title.createSpan({ cls: `line-marks-color-dot ${colorClass(item.color)}` });
		title.createSpan({ cls: 'line-marks-suggestion-text', text: item.label || displayText(item.text) });
		if (item.label) {
			content.createDiv({ cls: 'suggestion-note line-marks-suggestion-sub', text: displayText(item.text) });
		}
		content.createDiv({ cls: 'suggestion-note', text: `${item.path}:${item.line}` });
		if (item.isMissing) {
			el.addClass('is-missing');
			const badge = title.createSpan({ cls: 'line-marks-missing-badge' });
			setIcon(badge.createSpan({ cls: 'line-marks-missing-icon' }), 'alert-triangle');
			badge.createSpan({ text: 'File not found' });
			setTooltip(el, MISSING_FILE_TOOLTIP);
		}

		const button = el.createDiv({ cls: 'line-marks-unmark-button clickable-icon', attr: { 'aria-label': 'Unmark' } });
		setIcon(button, 'x');
		// Do not choose the item (jump), and keep the focus on the search input.
		button.addEventListener('mousedown', event => event.preventDefault());
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.unmark(item);
		});
	}

	// For a mark of a missing file, explain why and what to do without closing the modal.
	selectSuggestion(item: MarkListItem, event: MouseEvent | KeyboardEvent): void {
		if (item.isMissing) {
			noticeMissingFile();
			return;
		}
		super.selectSuggestion(item, event);
	}

	onChooseSuggestion(item: MarkListItem, event: MouseEvent | KeyboardEvent): void {
		void this.openMark(item.path, item.line, !!Keymap.isModEvent(event));
	}

	// A method rather than a getter, because a getter makes the assignment `this.chooser = ...` in the parent constructor fail.
	private getChooser(): Chooser {
		return (this as unknown as { chooser: Chooser }).chooser;
	}

	private unmark(item: MarkListItem): void {
		unmarkItem(this.store, item);
		this.items = this.items.filter(other => other !== item);
		this.refresh();
	}

	// Rebuilds the results, keeping the selection where possible.
	private refresh(): void {
		const chooser = this.getChooser();
		const { selectedItem } = chooser;
		this.inputEl.dispatchEvent(new Event('input'));
		const count = chooser.values?.length ?? 0;
		if (count) {
			chooser.setSelectedItem(Math.min(selectedItem, count - 1));
		}
	}
}
