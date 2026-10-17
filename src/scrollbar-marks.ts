import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { setTooltip } from 'obsidian';
import { marksField } from './mark-extension';
import { Mark } from './mark-tracker';
import { colorClass } from './color';
import { flashLine } from './flash-line';

type Marker = { mark: Mark, top: number, text: string };

// `top` and `height` are the position (from the top of the editor) and height to lay the track over the scrolling area.
type Measure = { top: number, height: number, markers: Marker[] };

// Highlights the target line, like other jumps (from commands and the mark lists).
const jumpTo = (view: EditorView, from: number): void => {
	view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
	view.focus();
	flashLine(view, from);
};

// Shows where the marks in the file are along the scrollbar. Clicking a marker jumps to its line.
// It cannot draw on the scrollbar itself, so it draws on a track laid over the right edge of the editor.
export const scrollbarMarks = ViewPlugin.fromClass(class implements PluginValue {
	private trackEl: HTMLElement;

	constructor(private view: EditorView) {
		this.trackEl = view.dom.createDiv({ cls: 'line-marks-scrollbar' });
		this.requestMeasure();
	}

	update(update: ViewUpdate): void {
		const isMarksChanged = update.startState.field(marksField) !== update.state.field(marksField);
		if (isMarksChanged || update.docChanged || update.geometryChanged || update.heightChanged) {
			this.requestMeasure();
		}
	}

	destroy(): void {
		this.trackEl.remove();
	}

	private requestMeasure(): void {
		this.view.requestMeasure({ key: this, read: view => this.measure(view), write: measure => this.render(measure) });
	}

	// Hidden when there is nothing to scroll (the whole file is visible).
	private measure(view: EditorView): Measure | null {
		const marks = view.state.field(marksField);
		const scroller = view.scrollDOM;
		const { scrollHeight, clientHeight } = scroller;
		if (!marks.length || scrollHeight <= clientHeight) {
			return null;
		}
		const scrollerRect = scroller.getBoundingClientRect();
		// How far the document starts below the top of the scrolling area (the inline title and properties).
		const contentTop = view.documentTop - scrollerRect.top + scroller.scrollTop;
		const markers = marks.map(mark => {
			const block = view.lineBlockAt(mark.from);
			const center = contentTop + block.top + block.height / 2;
			return { mark, top: center / scrollHeight * clientHeight, text: view.state.doc.lineAt(mark.from).text };
		});
		return { top: scrollerRect.top - view.dom.getBoundingClientRect().top, height: clientHeight, markers };
	}

	private render(measure: Measure | null): void {
		this.trackEl.empty();
		this.trackEl.toggle(!!measure);
		if (!measure) {
			return;
		}
		this.trackEl.setCssStyles({ top: `${measure.top}px`, height: `${measure.height}px` });
		for (const { mark, top, text } of measure.markers) {
			const markerEl = this.trackEl.createDiv({ cls: `line-marks-scrollbar-marker ${colorClass(mark.color)}` });
			markerEl.setCssStyles({ top: `${top}px` });
			setTooltip(markerEl, mark.label || text || '(empty line)', { placement: 'left' });
			// Do not affect the focus of the editor or the scrollbar.
			markerEl.addEventListener('mousedown', event => event.preventDefault());
			markerEl.addEventListener('click', () => jumpTo(this.view, mark.from));
		}
	}
});
