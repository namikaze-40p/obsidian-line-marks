import { EditorView, gutter, GutterMarker, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { editorInfoField, Platform, setTooltip, TFile } from 'obsidian';
import { MarkStore } from './mark-store';
import { applyRestoredMarks, invertMarkRemoval, Mark, remapMarks, restoreMarksEffect, sortMarks } from './mark-tracker';
import { pickMeta, restoreMarks } from './mark-restore';
import { MarkMeta, SavedMark } from './type';
import { colorClass } from './color';

export const setMarksEffect = StateEffect.define<Mark[]>();
// `pos` is any position in the line to mark or unmark. The time it was marked is decided by the dispatcher, to keep the reducer pure.
// `meta` is the label and color (the default color) of a new mark. Not used when unmarking.
export const toggleMarkEffect = StateEffect.define<{ pos: number, createdAt: number, meta: MarkMeta }>();
// Replaces the label and color of the mark on the line at `pos`. Marks the line if it has no mark.
export const editMarkEffect = StateEffect.define<{ pos: number, createdAt: number, meta: MarkMeta }>();

export const toggleMark = (view: EditorView, pos: number, meta: MarkMeta): void => {
	view.dispatch({ effects: toggleMarkEffect.of({ pos, createdAt: Date.now(), meta }) });
};

export const editMark = (view: EditorView, pos: number, meta: MarkMeta): void => {
	view.dispatch({ effects: editMarkEffect.of({ pos, createdAt: Date.now(), meta }) });
};

// The mark on the line at `pos`, or null.
export const findMark = (state: EditorState, pos: number): Mark | null => {
	const from = state.doc.lineAt(pos).from;
	return state.field(marksField).find(mark => mark.from === from) ?? null;
};

// Called when the gutter is right-clicked (tapped on touch devices). `pos` is the offset of the start of the line.
export type GutterMenuHandler = (view: EditorView, pos: number, event: MouseEvent) => void;

export type MarkExtensionOptions = {
	onGutterMenu: GutterMenuHandler,
	// The label and color of a new mark. Called each time a line is marked, so that changes to the settings apply right away.
	getDefaultMeta: () => MarkMeta,
};

export const marksField = StateField.define<Mark[]>({
	create: () => [],
	update(marks, tr) {
		let next = applyRestoredMarks(tr.docChanged ? remapMarks(marks, tr) : marks, tr);
		for (const effect of tr.effects) {
			if (effect.is(setMarksEffect)) {
				next = effect.value;
			} else if (effect.is(toggleMarkEffect)) {
				const from = tr.state.doc.lineAt(effect.value.pos).from;
				next = next.some(mark => mark.from === from)
					? next.filter(mark => mark.from !== from)
					: sortMarks([...next, { from, createdAt: effect.value.createdAt, ...pickMeta(effect.value.meta) }]);
			} else if (effect.is(editMarkEffect)) {
				const from = tr.state.doc.lineAt(effect.value.pos).from;
				const existing = next.find(mark => mark.from === from);
				const meta = pickMeta(effect.value.meta);
				next = existing
					? next.map(mark => mark === existing ? { from, createdAt: mark.createdAt, ...meta } : mark)
					: sortMarks([...next, { from, createdAt: effect.value.createdAt, ...meta }]);
			}
		}
		return next;
	},
});

class MarkMarker extends GutterMarker {
	constructor(private meta: MarkMeta) {
		super();
	}

	eq(other: MarkMarker): boolean {
		return this.meta.label === other.meta.label && this.meta.color === other.meta.color;
	}

	toDOM() {
		const el = createSpan({ cls: `line-marks-icon ${colorClass(this.meta.color)}` });
		if (this.meta.label) {
			setTooltip(el, this.meta.label);
		}
		return el;
	}
}

const spacerMarker = new MarkMarker({});

const createMarkGutter = ({ onGutterMenu, getDefaultMeta }: MarkExtensionOptions) => gutter({
	class: 'line-marks-gutter',
	markers: view => RangeSet.of(view.state.field(marksField).map(mark => new MarkMarker(pickMeta(mark)).range(mark.from))),
	initialSpacer: () => spacerMarker,
	domEventHandlers: {
		mousedown(view, line, event) {
			// Right-click opens the menu, so only left-click marks / unmarks.
			// On touch devices, tapping opens the menu instead (on click), so that touching the narrow gutter does not mark / unmark by accident.
			if ((event as MouseEvent).button !== 0 || Platform.isMobile) {
				return false;
			}
			toggleMark(view, line.from, getDefaultMeta());
			return true;
		},
		click(view, line, event) {
			if (!Platform.isMobile) {
				return false;
			}
			onGutterMenu(view, line.from, event as MouseEvent);
			return true;
		},
		contextmenu(view, line, event) {
			onGutterMenu(view, line.from, event as MouseEvent);
			return true;
		},
	},
});

const toSavedMarks = (state: EditorState): SavedMark[] => state.field(marksField).map(mark => {
	const line = state.doc.lineAt(mark.from);
	return { line: line.number, text: line.text, createdAt: mark.createdAt, ...pickMeta(mark) };
});

// Whether this is a nested editor, such as a table cell. Tables in Live Preview create a separate EditorView for each cell,
// and plugin extensions are applied to them too. A nested editor is a different EditorView from the note's editor (editor.cm of editorInfoField).
// While the note's editor itself is being created, editor.cm does not exist yet, so it is not treated as nested in that case.
const isNestedEditor = (view: EditorView): boolean => {
	const cm = (view.state.field(editorInfoField, false)?.editor as { cm?: EditorView } | undefined)?.cm;
	return !!cm && cm !== view;
};

// A change that replaces the whole file (e.g. when another file is opened in the same editor).
const isDocReplaced = (update: ViewUpdate): boolean => {
	let replaced = false;
	update.changes.iterChangedRanges((fromA, toA) => {
		replaced = replaced || (fromA === 0 && toA === update.startState.doc.length && toA > 0);
	});
	return replaced;
};

const createMarkSync = (store: MarkStore) => ViewPlugin.fromClass(class implements PluginValue {
	private path: string | null = null;
	private isLoaded = false;
	private isDestroyed = false;
	// Whether this is a nested editor. Decided when first needed (null means not decided yet).
	private nested: boolean | null = null;
	private unsubscribe: () => void;
	// Another editor of the same file whose marks this editor waits to copy, until the documents become the same (see onNotified).
	private pendingSource: EditorView | null = null;

	constructor(private view: EditorView) {
		this.unsubscribe = store.subscribe((path, source) => this.onNotified(path, source));
		this.checkFile();
		this.scheduleLoad();
	}

	update(update: ViewUpdate): void {
		if (this.isNested()) {
			return;
		}
		if (this.checkFile() || (update.docChanged && isDocReplaced(update))) {
			this.isLoaded = false;
			this.pendingSource = null;
			this.scheduleLoad();
			return;
		}
		if (!this.isLoaded || !this.path) {
			return;
		}
		const isMarkChanged = update.transactions.some(tr => tr.effects.some(effect =>
			effect.is(toggleMarkEffect) || effect.is(editMarkEffect) || effect.is(restoreMarksEffect)));
		if (isMarkChanged || update.docChanged) {
			store.set(this.path, toSavedMarks(update.state), { ctime: this.getFile()?.stat.ctime, source: this.view, notify: isMarkChanged });
		}
		if (update.docChanged && this.pendingSource) {
			// Cannot dispatch during an update, so copy after it finishes.
			queueMicrotask(() => this.copyPendingMarks());
		}
	}

	destroy(): void {
		this.isDestroyed = true;
		this.unsubscribe();
	}

	private getFile(): TFile | null {
		return this.view.state.field(editorInfoField, false)?.file ?? null;
	}

	// Returns true if the file has changed.
	private checkFile(): boolean {
		const path = this.getFile()?.path ?? null;
		if (path === this.path) {
			return false;
		}
		this.path = path;
		return true;
	}

	// Called when the marks of the file are changed outside this editor: in another editor of the same file (`source`, e.g. split panes),
	// or in the mark lists or data.json (`source` is null).
	// Undo in another editor puts back marks there, and this editor receives the change of the document only later.
	// Loading the saved marks before that would put them on the wrong lines, so wait until the documents become the same.
	private onNotified(path: string, source: EditorView | null): void {
		if (path !== this.path || source === this.view) {
			return;
		}
		if (source) {
			this.pendingSource = source;
			this.copyPendingMarks();
		} else {
			this.pendingSource = null;
			this.load();
		}
	}

	// Copies the marks of the other editor once the documents are the same. They are copied instead of loading the saved marks,
	// because this editor saves its own marks (without the restored ones) when it receives the change. So save them again too.
	private copyPendingMarks(): void {
		const source = this.pendingSource;
		if (!source || this.isDestroyed || !this.path || this.isNested() || !source.state.doc.eq(this.view.state.doc)) {
			return;
		}
		this.pendingSource = null;
		this.view.dispatch({ effects: setMarksEffect.of(source.state.field(marksField)) });
		this.isLoaded = true;
		store.set(this.path, toSavedMarks(this.view.state), { ctime: this.getFile()?.stat.ctime, source: this.view });
	}

	// Cannot dispatch during an update, so load after it finishes.
	private scheduleLoad(): void {
		queueMicrotask(() => this.load());
	}

	// Nested editors neither load nor save marks, so that the marks of the note's editor are not overwritten with the cell's content.
	private isNested(): boolean {
		this.nested ??= isNestedEditor(this.view);
		return this.nested;
	}

	private load(): void {
		if (this.isDestroyed || !this.path || this.isNested()) {
			return;
		}
		const marks = restoreMarks(this.view.state.doc, store.getFile(this.path), this.getFile()?.stat.ctime);
		this.view.dispatch({ effects: setMarksEffect.of(marks) });
		this.isLoaded = true;
	}
});

// Adds a class to nested editors to hide the gutter with CSS. CodeMirror rewrites the class attribute of the editor on every update,
// so add it with editorAttributes instead of addClass.
const nestedEditorClass = EditorView.editorAttributes.of(view => isNestedEditor(view) ? { class: 'line-marks-nested' } : null);

export const createMarkExtension = (store: MarkStore, options: MarkExtensionOptions) => [marksField, invertMarkRemoval(marksField), createMarkGutter(options), createMarkSync(store), nestedEditorClass];
