import { TFile, View, WorkspaceLeaf, WorkspaceTabs } from 'obsidian';

export type MarkColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

// The label and color of a mark. Both are optional and omitted when absent (to keep the saved data small).
export type MarkMeta = { label?: string, color?: MarkColor };

// `line` is the line number including the frontmatter (1-based). `text` is for matching when restoring. `createdAt` is when it was marked (epoch milliseconds).
export type SavedMark = { line: number, text: string, createdAt: number } & MarkMeta;

// `ctime` is the creation time of the file when saved. Used to tell whether the file at the same path has been replaced by another one.
export type SavedFile = { ctime: number, marks: SavedMark[] };

export type WindowItem = { id: string, window: Window, leaves: CustomWsLeaf[] };

export type CustomWsLeaf = WorkspaceLeaf & {
	id?: string,
	containerEl?: Element,
	parent?: WorkspaceTabs & { id: string },
	view: View & { file: TFile, state: { file: string } },
};
