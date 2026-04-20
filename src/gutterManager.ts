import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideGutterManager implements vscode.Disposable {
    private readonly overrideDecorationType: vscode.TextEditorDecorationType;
    private readonly implementationDecorationType: vscode.TextEditorDecorationType;
    private activeEditor: vscode.TextEditor | undefined;

    constructor(extensionUri: vscode.Uri) {
        const assetsUri = vscode.Uri.joinPath(extensionUri, 'assets');

        this.overrideDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            gutterIconSize: 'contain',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            light: {
                gutterIconPath: vscode.Uri.joinPath(assetsUri, 'override-light.svg')
            },
            dark: {
                gutterIconPath: vscode.Uri.joinPath(assetsUri, 'override-dark.svg')
            }
        });

        this.implementationDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            gutterIconSize: 'contain',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            light: {
                gutterIconPath: vscode.Uri.joinPath(assetsUri, 'implementation-light.svg')
            },
            dark: {
                gutterIconPath: vscode.Uri.joinPath(assetsUri, 'implementation-dark.svg')
            }
        });
    }

    public update(editor: vscode.TextEditor | undefined, items: OverrideItem[]): void {
        if (this.activeEditor && this.activeEditor !== editor) {
            this.clearEditor(this.activeEditor);
        }

        this.activeEditor = editor;

        if (!editor || editor.document.languageId !== 'python' || !this.isEnabled()) {
            if (editor) {
                this.clearEditor(editor);
            }
            return;
        }

        const overrideDecorations: vscode.DecorationOptions[] = [];
        const implementationDecorations: vscode.DecorationOptions[] = [];

        for (const item of items) {
            if (item.type === 'override' && item.parentMethodName) {
                overrideDecorations.push({
                    range: item.range
                });
            }

            if (item.type === 'implementation' && item.childMethods && item.childMethods.length > 0) {
                implementationDecorations.push({
                    range: item.range
                });
            }
        }

        editor.setDecorations(this.overrideDecorationType, overrideDecorations);
        editor.setDecorations(this.implementationDecorationType, implementationDecorations);
    }

    public clear(): void {
        if (this.activeEditor) {
            this.clearEditor(this.activeEditor);
            this.activeEditor = undefined;
        }
    }

    public dispose(): void {
        this.clear();
        this.overrideDecorationType.dispose();
        this.implementationDecorationType.dispose();
    }

    private isEnabled(): boolean {
        return vscode.workspace.getConfiguration('pythonOverrideMark').get<boolean>('gutterIcons.enabled', true);
    }

    private clearEditor(editor: vscode.TextEditor): void {
        editor.setDecorations(this.overrideDecorationType, []);
        editor.setDecorations(this.implementationDecorationType, []);
    }
}
