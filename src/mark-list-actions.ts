import { App, Notice, TFile } from 'obsidian';
import { MarkStore } from './mark-store';
import { LabelCandidate, MarkListItem, summarizeLabels } from './mark-list';
import { ConfirmModal } from './confirm-modal';
import { EditMarkModal } from './edit-mark-modal';
import { pickMeta } from './mark-restore';

export const MISSING_FILE_TOOLTIP = 'This file may have been renamed or deleted outside Obsidian.';

const NOTICE_TEXT_MAX_LENGTH = 40;

export const displayText = (text: string): string => text || '(empty line)';

export const pluralize = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const truncate = (text: string): string =>
	text.length > NOTICE_TEXT_MAX_LENGTH ? `${text.slice(0, NOTICE_TEXT_MAX_LENGTH)}…` : text;

export const loadMarkListItems = (app: App, store: MarkStore): MarkListItem[] => {
	return store.paths().flatMap(path => {
		const isMissing = !(app.vault.getAbstractFileByPath(path) instanceof TFile);
		return store.get(path).map(mark => ({ path, line: mark.line, text: mark.text, createdAt: mark.createdAt, isMissing, ...pickMeta(mark) }));
	});
};

export const unmarkItem = (store: MarkStore, item: MarkListItem): void => {
	const marks = store.get(item.path).filter(({ line }) => line !== item.line);
	// Notify, so that open editors are updated too.
	store.set(item.path, marks, { notify: true });
	new Notice(`Unmarked "${truncate(displayText(item.text))}" (${item.path}:${item.line})`);
};

// Builds label suggestions from all marks in the vault (including those of missing files).
export const collectLabels = (store: MarkStore): LabelCandidate[] =>
	summarizeLabels(store.paths().flatMap(path => store.get(path)));

// Edits the label and color from a mark list. Notifies, so that open editors are updated too.
export const editMarkItem = (app: App, store: MarkStore, item: MarkListItem, onSaved?: () => void): void => {
	new EditMarkModal(app, item, collectLabels(store), meta => {
		const marks = store.get(item.path).map(mark => mark.line === item.line
			? { line: mark.line, text: mark.text, createdAt: mark.createdAt, ...meta }
			: mark);
		store.set(item.path, marks, { notify: true });
		onSaved?.();
	}).open();
};

// Explains why and what to do, when a mark of a missing file is chosen.
export const noticeMissingFile = (): void => {
	new Notice(`The file was not found. ${MISSING_FILE_TOOLTIP} Unmark it to remove it from the list.`);
};

// Unmarks all marks in a file, after confirmation because it cannot be undone. Notifies, so that open editors are updated too.
export const confirmUnmarkFile = (app: App, store: MarkStore, path: string, onUnmarked?: () => void): void => {
	const count = store.get(path).length;
	if (!count) {
		return;
	}
	const message = `Unmark ${count === 1 ? 'the mark' : `all ${pluralize(count, 'mark')}`} in ${path}? This cannot be undone.`;
	new ConfirmModal(app, 'Unmark all in file', message, 'Unmark all', () => {
		store.set(path, [], { notify: true });
		new Notice(`Unmarked ${pluralize(count, 'mark')} in ${path}.`);
		onUnmarked?.();
	}).open();
};

// Unmarks all marks, after confirmation because it cannot be undone.
export const confirmUnmarkAll = (app: App, store: MarkStore): void => {
	const paths = store.paths();
	const count = paths.reduce((acc, path) => acc + store.get(path).length, 0);
	if (!count) {
		new Notice('No marks.');
		return;
	}
	const message = `Unmark all ${pluralize(count, 'mark')} in ${pluralize(paths.length, 'file')}? This cannot be undone.`;
	new ConfirmModal(app, 'Unmark all in vault', message, 'Unmark all', () => {
		paths.forEach(path => store.set(path, [], { notify: true }));
		new Notice(`Unmarked ${pluralize(count, 'mark')} in ${pluralize(paths.length, 'file')}.`);
	}).open();
};
