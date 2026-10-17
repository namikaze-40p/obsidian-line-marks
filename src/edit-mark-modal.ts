import { AbstractInputSuggest, App, Modal, prepareFuzzySearch, renderMatches, setIcon, Setting } from 'obsidian';
import { LabelCandidate } from './mark-list';
import { pickMeta } from './mark-restore';
import { MarkColor, MarkMeta } from './type';
import { colorClass, MARK_COLORS } from './color';

// Suggests labels already in use: all of them when the input is empty, narrowed down by fuzzy match as the user types.
class LabelSuggest extends AbstractInputSuggest<LabelCandidate> {
	// When opened with a label already filled in, do not suggest until the user types.
	private isWaitingForInput: boolean;
	private query = '';

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private candidates: LabelCandidate[],
		private onChoose: (candidate: LabelCandidate) => void,
	) {
		super(app, inputEl);
		this.isWaitingForInput = !!inputEl.value;
		// Done on beforeinput, so that it is cleared before the suggestions are updated (on input).
		inputEl.addEventListener('beforeinput', () => this.isWaitingForInput = false);
	}

	protected getSuggestions(query: string): LabelCandidate[] {
		if (this.isWaitingForInput) {
			return [];
		}
		this.query = query.trim();
		if (!this.query) {
			return this.candidates;
		}
		const search = prepareFuzzySearch(this.query);
		return this.candidates
			.map(candidate => ({ candidate, score: search(candidate.label)?.score }))
			.filter((result): result is { candidate: LabelCandidate, score: number } => result.score !== undefined)
			.sort((a, b) => b.score - a.score || b.candidate.count - a.candidate.count)
			.map(({ candidate }) => candidate);
	}

	renderSuggestion(candidate: LabelCandidate, el: HTMLElement): void {
		el.addClass('line-marks-label-suggestion');
		el.createSpan({ cls: `line-marks-color-dot ${colorClass(candidate.color)}` });
		const matches = this.query ? prepareFuzzySearch(this.query)(candidate.label)?.matches ?? null : null;
		renderMatches(el.createSpan({ cls: 'line-marks-label-suggestion-text' }), candidate.label, matches);
		el.createSpan({ cls: 'line-marks-label-suggestion-count', text: String(candidate.count) });
	}

	selectSuggestion(candidate: LabelCandidate): void {
		this.setValue(candidate.label);
		this.close();
		this.onChoose(candidate);
	}
}

// Edits the label and color of a mark.
export class EditMarkModal extends Modal {
	private label: string;
	private color: MarkColor | undefined;
	private colorButtons: { el: HTMLElement, color: MarkColor | undefined }[] = [];

	constructor(
		app: App,
		meta: MarkMeta,
		private labels: LabelCandidate[],
		private onSave: (meta: MarkMeta) => void,
	) {
		super(app);
		this.label = meta.label ?? '';
		this.color = meta.color;
		this.setTitle('Edit label and color');
		this.modalEl.addClass('line-marks-edit-modal');
	}

	onOpen(): void {
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('Label')
			.addText(text => {
				text
					.setPlaceholder('No label')
					.setValue(this.label)
					.onChange(value => this.label = value);
				const { inputEl } = text;
				new LabelSuggest(this.app, inputEl, this.labels, candidate => {
					this.label = candidate.label;
					this.selectColor(candidate.color);
				});
				// While suggestions are shown, Enter goes to the scope of the suggestions, so this is reached only when none are shown.
				this.scope.register([], 'Enter', event => {
					if (event.isComposing || event.target !== inputEl) {
						return;
					}
					event.preventDefault();
					this.save();
					return false;
				});
				// When the input is empty, suggest all labels on focus.
				inputEl.addEventListener('focus', () => {
					if (!inputEl.value) {
						inputEl.dispatchEvent(new Event('input'));
					}
				});
				// Let the user type right after opening.
				window.setTimeout(() => inputEl.select());
			});

		const colorSetting = new Setting(contentEl).setName('Color');
		const swatches = colorSetting.controlEl.createDiv({ cls: 'line-marks-color-swatches', attr: { role: 'radiogroup', 'aria-label': 'Color' } });
		const options: [MarkColor | undefined, string][] = [[undefined, 'No color'], ...Object.entries(MARK_COLORS) as [MarkColor, string][]];
		this.colorButtons = options.map(([color, name]) => {
			// Made of div, because <button> gets Obsidian's button styles (height, background on mobile, etc.) and is not a circle.
			const button = swatches.createDiv({
				cls: `line-marks-color-swatch ${colorClass(color)}`,
				attr: { role: 'radio', 'aria-label': name },
			});
			if (!color) {
				setIcon(button, 'ban');
			}
			button.addEventListener('click', () => this.selectColor(color));
			button.addEventListener('keydown', event => this.onColorKeyDown(event, color));
			return { el: button, color };
		});
		this.selectColor(this.color);

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText('Cancel')
				.onClick(() => this.close()))
			.addButton(button => button
				.setButtonText('Save')
				.setCta()
				.onClick(() => this.save()));
	}

	private selectColor(color: MarkColor | undefined): void {
		this.color = color;
		// Like radio buttons, Tab stops only at the selected color, and arrow keys move within the group.
		this.colorButtons.forEach(button => {
			const isSelected = button.color === color;
			button.el.toggleClass('is-selected', isSelected);
			button.el.setAttribute('aria-checked', String(isSelected));
			button.el.setAttribute('tabindex', isSelected ? '0' : '-1');
		});
	}

	private onColorKeyDown(event: KeyboardEvent, color: MarkColor | undefined): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			this.selectColor(color);
			return;
		}
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
		if (!step) {
			return;
		}
		event.preventDefault();
		const count = this.colorButtons.length;
		const index = this.colorButtons.findIndex(button => button.color === color);
		const next = this.colorButtons[(index + step + count) % count];
		this.selectColor(next.color);
		next.el.focus();
	}

	private save(): void {
		this.close();
		this.onSave(pickMeta({ label: this.label.trim(), color: this.color }));
	}
}
