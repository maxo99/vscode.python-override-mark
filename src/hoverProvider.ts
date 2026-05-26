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

        const messages: vscode.MarkdownString[] = [];
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

            if (!messages.some(existing => existing.value === message.value)) {
                messages.push(message);
            }

            hoverRange = hoverRange
                ? hoverRange.union(lineRange)
                : lineRange;
        }

        if (messages.length === 0 || !hoverRange) {
            return undefined;
        }

        return new vscode.Hover(messages, hoverRange);
    }

    private getHoverMessage(item: OverrideItem): vscode.MarkdownString | undefined {
        if (item.type === 'override' && item.parentMethodName) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.appendMarkdown(`Overrides ${item.parentMethodName}`);

            if (item.parentUri && item.parentRange) {
                const commandUri = this.createCommandUri('pythonOverrideMark.navigateTo', [
                    item.parentUri.toString(),
                    item.parentRange.start.line,
                    item.parentRange.start.character
                ]);
                markdown.appendMarkdown(`  
[Go to parent](${commandUri})`);
            }

            return markdown;
        }

        if (item.type === 'implementation' && item.childMethods && item.childMethods.length > 0) {
            const message = item.childMethods.length === 1
                ? 'Implemented in 1 subclass'
                : `Implemented in ${item.childMethods.length} subclasses`;
            return this.createNavigationMarkdown(message, 'Show implementations', item.childMethods);
        }

        if (item.type === 'subclassed' && item.subclasses && item.subclasses.length > 0) {
            const message = item.subclasses.length === 1
                ? 'Subclassed by 1 class'
                : `Subclassed by ${item.subclasses.length} classes`;
            return this.createNavigationMarkdown(message, 'Show subclasses', item.subclasses);
        }

        return undefined;
    }

    private createNavigationMarkdown(message: string, linkText: string, targets: { name: string, uri: vscode.Uri, range: vscode.Range }[]): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.appendMarkdown(message);

        const commandTargets = targets.map(target => ({
            name: target.name,
            uri: target.uri.toString(),
            range: {
                start: {
                    line: target.range.start.line,
                    character: target.range.start.character
                }
            }
        }));
        const commandUri = this.createCommandUri('pythonOverrideMark.showOverrides', [commandTargets]);
        markdown.appendMarkdown(`  
[${linkText}](${commandUri})`);

        return markdown;
    }

    private createCommandUri(command: string, args: unknown[]): vscode.Uri {
        return vscode.Uri.parse(`command:${command}?${encodeURIComponent(JSON.stringify(args))}`);
    }

    private isEnabled(): boolean {
        return vscode.workspace.getConfiguration('pythonOverrideMark').get<boolean>('hover.enabled', true);
    }
}
