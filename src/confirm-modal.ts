import { App, Modal, Setting } from 'obsidian';

// Asks for confirmation before an action that cannot be undone.
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		title: string,
		message: string,
		private confirmText: string,
		private onConfirm: () => void,
	) {
		super(app);
		this.setTitle(title);
		this.setContent(message);
	}

	onOpen(): void {
		new Setting(this.contentEl)
			.addButton(button => button
				.setButtonText('Cancel')
				.onClick(() => this.close()))
			.addButton(button => button
				.setButtonText(this.confirmText)
				.setDestructive()
				.setCta()
				.onClick(() => {
					this.close();
					this.onConfirm();
				}));
	}
}
