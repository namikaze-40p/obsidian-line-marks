import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { findWidget } from './block-widget';

// The same duration (ms) as Obsidian's own highlight when showing a line in reading mode.
export const FLASH_DURATION = 3000;

// The offset of the start of the line to highlight. null removes the highlight.
const flashEffect = StateEffect.define<number | null>();

// Uses the same class as Obsidian's own highlight, for the same look.
const flashDecoration = Decoration.line({ class: 'is-flashing' });

export const flashField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		let next = decorations.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(flashEffect)) {
				next = effect.value === null ? Decoration.none : Decoration.set(flashDecoration.range(effect.value));
			}
		}
		return next;
	},
	provide: field => EditorView.decorations.from(field),
});

// Only one highlight per editor. On another jump, the previous highlight (line or widget) is removed right away,
// and the previous timer does not remove the new highlight early.
type FlashState = { timer: number, widgetEl: HTMLElement | null };
const flashes = new WeakMap<EditorView, FlashState>();

const clearFlash = (view: EditorView): void => {
	const flash = flashes.get(view);
	if (!flash) {
		return;
	}
	window.clearTimeout(flash.timer);
	flash.widgetEl?.removeClass('is-flashing');
	flashes.delete(view);
	// If the editor is gone (e.g. the tab was closed), there is no line highlight to remove.
	if (view.dom.isConnected) {
		view.dispatch({ effects: flashEffect.of(null) });
	}
};

// Highlights the line jumped to for a while. `findTarget` finds an element to highlight instead of the line.
// Otherwise, when the line is replaced by a widget (e.g. tables and callouts in Live Preview), where line decorations are not visible,
// the whole widget is highlighted, as the whole block is highlighted in reading mode.
export const flashLine = (view: EditorView, pos: number, findTarget?: () => HTMLElement | null): void => {
	clearFlash(view);
	view.dispatch({ effects: flashEffect.of(view.state.doc.lineAt(pos).from) });
	const flash: FlashState = { timer: window.setTimeout(() => clearFlash(view), FLASH_DURATION), widgetEl: null };
	flashes.set(view, flash);
	// The widget element may not exist until scrolled into view, so look for it after the view has updated.
	view.requestMeasure({
		read: () => null,
		write: () => {
			// If another jump happened while waiting, do not highlight the old position.
			if (flashes.get(view) !== flash) {
				return;
			}
			flash.widgetEl = findTarget?.() ?? findWidget(view, pos);
			flash.widgetEl?.addClass('is-flashing');
		},
	});
};
