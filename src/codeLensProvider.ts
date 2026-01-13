import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private items: OverrideItem[] = [];

    public updateResults(items: OverrideItem[]) {
        this.items = items;
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];

        for (const item of this.items) {
            if (item.type === 'override') {
                if (item.parentUri && item.parentRange) {
                    const command: vscode.Command = {
                        title: `$(arrow-up) ${item.parentMethodName}`,
                        command: 'pythonOverrideMark.navigateTo',
                        arguments: [
                            item.parentUri.toString(),
                            item.parentRange.start.line,
                            item.parentRange.start.character
                        ]
                    };
                    lenses.push(new vscode.CodeLens(item.range, command));
                }
            } else if (item.type === 'implementation') {
                if (item.childMethods && item.childMethods.length > 0) {
                    const count = item.childMethods.length;
                    const label = count === 1
                        ? `$(arrow-down) ${item.childMethods[0].name}`
                        : `$(arrow-down) ${count}`;

                    const command: vscode.Command = {
                        title: label,
                        command: 'pythonOverrideMark.showOverrides',
                        arguments: [item.childMethods]
                    };
                    lenses.push(new vscode.CodeLens(item.range, command));
                }
            } else if (item.type === 'subclassed') {
                if (item.subclasses && item.subclasses.length > 0) {
                    const count = item.subclasses.length;
                    const label = count === 1
                        ? `$(arrow-down) ${item.subclasses[0].name}`
                        : `$(arrow-down) ${count}`;

                    const command: vscode.Command = {
                        title: label,
                        command: 'pythonOverrideMark.showOverrides',
                        arguments: [item.subclasses]
                    };
                    lenses.push(new vscode.CodeLens(item.range, command));
                }
            }
        }

        return lenses;
    }
}
