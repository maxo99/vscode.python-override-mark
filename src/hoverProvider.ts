import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideHoverProvider implements vscode.HoverProvider {
    private documentUri: string | undefined;
    private items: OverrideItem[] = [];

    public updateResults(editor: vscode.TextEditor | undefined, items: OverrideItem[]): void {
        this.documentUri = editor?.document.uri.toString();
        this.items = items;
    }

    public provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!this.isEnabled()) {
            return undefined;
        }

        if (document.uri.toString() !== this.documentUri) {
            return undefined;
        }

        const messages: string[] = [];
        let hoverRange: vscode.Range | undefined;

        for (const item of this.items) {
            const lineRange = document.lineAt(item.range.start.line).range;
            if (!lineRange.contains(position)) {
                continue;
            }

            const message = this.getHoverMessage(item);
            if (!message) {
                continue;
            }

            if (!messages.includes(message)) {
                messages.push(message);
            }

            hoverRange = hoverRange
                ? hoverRange.union(lineRange)
                : lineRange;
        }

        if (messages.length === 0 || !hoverRange) {
            return undefined;
        }

        return new vscode.Hover(messages.join('\n\n'), hoverRange);
    }

    private getHoverMessage(item: OverrideItem): string | undefined {
        if (item.type === 'override' && item.parentMethodName) {
            return `Overrides ${item.parentMethodName}`;
        }

        if (item.type === 'implementation' && item.childMethods && item.childMethods.length > 0) {
            return item.childMethods.length === 1
                ? 'Implemented in 1 subclass'
                : `Implemented in ${item.childMethods.length} subclasses`;
        }

        return undefined;
    }

    private isEnabled(): boolean {
        return vscode.workspace.getConfiguration('pythonOverrideMark').get<boolean>('gutterIcons.enabled', true);
    }
}
