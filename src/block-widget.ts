import { BlockType, EditorView } from '@codemirror/view';

// Maximum number of frames to wait until an element is rendered.
const ELEMENT_WAIT_FRAMES = 60;

// Elements may not exist until rendered (in reading mode, or a widget scrolled into view), so wait until found (up to ELEMENT_WAIT_FRAMES frames).
export const waitForElement = (find: () => HTMLElement | null, onFound: (el: HTMLElement) => void): void => {
	let frames = 0;
	const tick = () => {
		const el = find();
		if (el) {
			onFound(el);
		} else if (++frames < ELEMENT_WAIT_FRAMES) {
			window.requestAnimationFrame(tick);
		}
	};
	window.requestAnimationFrame(tick);
};

// When lines are replaced by a widget (e.g. tables and callouts in Live Preview), returns the element of the widget.
export const findWidget = (view: EditorView, pos: number): HTMLElement | null => {
	const block = view.lineBlockAt(pos);
	if (block.type !== BlockType.WidgetRange) {
		return null;
	}
	const widgetEl = Array.from(view.contentDOM.children).find(child => {
		try {
			return view.posAtDOM(child) === block.from;
		} catch {
			return false;
		}
	});
	return widgetEl instanceof HTMLElement ? widgetEl : null;
};

// The latest jump in each editor, so that the centering of an earlier jump does not scroll away from a newer one.
const latestJumps = new WeakMap<EditorView, object>();

// Scrolling the editor to a line in a widget does not center it: the widget may not be rendered yet (e.g. right after opening the file),
// and a table scrolls the cell only just into view when it opens the editor of the cell (when the cursor moves into it).
// So once the widget is rendered, center the cell being edited (in a table) or the whole widget. Widgets taller than the screen are shown from the top.
export const centerWidget = (view: EditorView, pos: number): void => {
	const jump = {};
	latestJumps.set(view, jump);
	waitForElement(() => findWidget(view, pos), widgetEl => {
		// Wait one more frame for the editor of the cell, which is opened once the table is shown.
		window.requestAnimationFrame(() => {
			if (latestJumps.get(view) !== jump) {
				return;
			}
			const targetEl = widgetEl.find('.table-cell-wrapper')?.closest<HTMLElement>('td, th') ?? widgetEl;
			const isTaller = targetEl.getBoundingClientRect().height >= view.scrollDOM.clientHeight;
			targetEl.scrollIntoView({ block: isTaller ? 'start' : 'center' });
		});
	});
};
