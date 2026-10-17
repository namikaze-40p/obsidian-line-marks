import { EditorView } from '@codemirror/view';
import { SavedFile, SavedMark } from './type';

type Listener = (path: string, source: EditorView | null) => void;

type SetOptions = { ctime?: number, source?: EditorView | null, notify?: boolean };

// File path -> marks. The StateField is the source of truth for positions in editors; this holds line numbers and text for saving.
export class MarkStore {
	private listeners = new Set<Listener>();
	// For the mark lists. Called whenever the contents change, including position changes by editing.
	private changeListeners = new Set<() => void>();

	constructor(
		private files: Record<string, SavedFile>,
		private requestSave: () => void,
	) {}

	get(path: string): SavedMark[] {
		return this.files[path]?.marks || [];
	}

	getFile(path: string): SavedFile | undefined {
		return this.files[path];
	}

	// Paths of files with marks (the order of jumping across files).
	paths(): string[] {
		return Object.keys(this.files).sort();
	}

	// If `ctime` is omitted, the saved value is kept. If neither exists, it is 0 (matches no file, so restoring uses only lines whose text matches).
	// `notify` is true only when other panes should be updated (marking / unmarking).
	// Position changes by editing are not notified, because each pane follows them with its own ChangeSet.
	set(path: string, marks: SavedMark[], { ctime = this.files[path]?.ctime, source = null, notify = false }: SetOptions = {}): void {
		const file: SavedFile = { ctime: ctime ?? 0, marks };
		if (JSON.stringify(this.files[path]) === JSON.stringify(file)) {
			return;
		}
		if (marks.length) {
			this.files[path] = file;
		} else {
			delete this.files[path];
		}
		this.requestSave();
		this.emitChange();
		if (notify) {
			this.listeners.forEach(listener => listener(path, source));
		}
	}

	rename(oldPath: string, newPath: string): void {
		if (!this.files[oldPath]) {
			return;
		}
		this.files[newPath] = this.files[oldPath];
		delete this.files[oldPath];
		this.requestSave();
		this.emitChange();
	}

	delete(path: string): void {
		if (!this.files[path]) {
			return;
		}
		delete this.files[path];
		this.requestSave();
		this.emitChange();
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private emitChange(): void {
		this.changeListeners.forEach(listener => listener());
	}
}
