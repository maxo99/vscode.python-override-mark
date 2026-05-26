import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideInlayHintProvider implements vscode.InlayHintsProvider {
    private _onDidChangeInlayHints: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChangeInlayHints.event;

    private documentUri: string | undefined;
    private items: OverrideItem[] = [];

    public updateResults(editor: vscode.TextEditor | undefined, items: OverrideItem[]): void {
        this.documentUri = editor?.document.uri.toString();
        this.items = items;
        this._onDidChangeInlayHints.fire();
    }

    public provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): vscode.InlayHint[] {
        if (!this.isEnabled()) {
            return [];
        }

        if (document.uri.toString() !== this.documentUri) {
            return [];
        }

        const hints: vscode.InlayHint[] = [];

        for (const item of this.items) {
            if (!range.intersection(item.range)) {
                continue;
            }

            const hint = this.createHint(item);
            if (hint) {
                hints.push(hint);
            }
        }

        return hints;
    }

    private createHint(item: OverrideItem): vscode.InlayHint | undefined {
        if (item.type === 'override' && item.parentMethodName && item.parentUri && item.parentRange) {
            const label = new vscode.InlayHintLabelPart(`↑ ${item.parentMethodName}`);
            label.tooltip = `Go to ${item.parentMethodName}`;
            label.command = {
                title: `$(arrow-up) ${item.parentMethodName}`,
                command: 'pythonOverrideMark.navigateTo',
                arguments: [
                    item.parentUri.toString(),
                    item.parentRange.start.line,
                    item.parentRange.start.character
                ]
            };

            return this.buildHint(item, [label]);
        }

        if (item.type === 'implementation' && item.childMethods && item.childMethods.length > 0) {
            const count = item.childMethods.length;
            const text = count === 1
                ? `↓ ${item.childMethods[0].name}`
                : `↓ ${count}`;
            const label = new vscode.InlayHintLabelPart(text);
            label.tooltip = count === 1
                ? `Go to ${item.childMethods[0].name}`
                : 'Show implementations';
            label.command = {
                title: count === 1 ? `$(arrow-down) ${item.childMethods[0].name}` : `$(arrow-down) ${count}`,
                command: 'pythonOverrideMark.showOverrides',
                arguments: [item.childMethods]
            };

            return this.buildHint(item, [label]);
        }

        if (item.type === 'subclassed' && item.subclasses && item.subclasses.length > 0) {
            const count = item.subclasses.length;
            const text = count === 1
                ? `↓ ${item.subclasses[0].name}`
                : `↓ ${count}`;
            const label = new vscode.InlayHintLabelPart(text);
            label.tooltip = count === 1
                ? `Go to ${item.subclasses[0].name}`
                : 'Show subclasses';
            label.command = {
                title: count === 1 ? `$(arrow-down) ${item.subclasses[0].name}` : `$(arrow-down) ${count}`,
                command: 'pythonOverrideMark.showOverrides',
                arguments: [item.subclasses]
            };

            return this.buildHint(item, [label]);
        }

        return undefined;
    }

    private buildHint(item: OverrideItem, label: vscode.InlayHintLabelPart[]): vscode.InlayHint {
        const hint = new vscode.InlayHint(item.range.end, label, vscode.InlayHintKind.Parameter);
        hint.paddingLeft = true;
        return hint;
    }

    private isEnabled(): boolean {
        return vscode.workspace.getConfiguration('pythonOverrideMark').get<boolean>('display.inlayHints', false);
    }
}
