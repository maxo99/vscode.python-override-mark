import * as vscode from 'vscode';
import { OverrideDetector } from './overrideDetector';
import { OverrideCodeLensProvider } from './codeLensProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "python-override-mark" is now active!');

    const detector = new OverrideDetector();
    const codeLensProvider = new OverrideCodeLensProvider();

    // Register CodeLens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'python', scheme: 'file' }, codeLensProvider)
    );

    let activeEditor = vscode.window.activeTextEditor;
    let timeout: NodeJS.Timeout | undefined = undefined;

    const triggerUpdate = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        // Debounce
        const delay = vscode.workspace.getConfiguration('pythonOverrideMark').get<number>('debounceDelay', 500);
        timeout = setTimeout(() => {
            if (activeEditor && activeEditor.document.languageId === 'python') {
                // Ensure Python extension is activated
                const pythonExtension = vscode.extensions.getExtension('ms-python.python');
                if (pythonExtension && !pythonExtension.isActive) {
                    console.log('[OverrideMark] Waiting for Python extension to activate...');
                    pythonExtension.activate().then(() => {
                        console.log('[OverrideMark] Python extension activated');
                        // Re-trigger update after activation
                        triggerUpdate();
                    });
                    return; // Exit to avoid running detection before Python extension is ready
                }

                detector.detectOverrides(activeEditor).then(items => {
                    codeLensProvider.updateResults(items);
                }).catch(error => {
                    console.error('Error updating override marks:', error);
                });
            }
        }, delay);
    };

    // Initial check with a slight delay to allow other extensions to start
    if (activeEditor) {
        setTimeout(triggerUpdate, 1000);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            activeEditor = editor;
            if (editor) {
                triggerUpdate();
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor && event.document === activeEditor.document) {
                triggerUpdate();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pythonOverrideMark.navigateTo', async (uriStr: string, line: number, character: number) => {
            console.log(`[OverrideMark] Command triggered: navigateTo ${uriStr}:${line}:${character}`);
            try {
                const uri = vscode.Uri.parse(uriStr);
                const position = new vscode.Position(line, character);
                const document = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(document);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } catch (e) {
                console.error('[OverrideMark] Error navigating:', e);
            }
        }),
        vscode.commands.registerCommand('pythonOverrideMark.showOverrides', async (overrides: { name: string, uri: vscode.Uri, range: vscode.Range }[]) => {
            if (!overrides || overrides.length === 0) return;

            if (overrides.length === 1) {
                const target = overrides[0];
                vscode.commands.executeCommand('pythonOverrideMark.navigateTo', target.uri.toString(), target.range.start.line, target.range.start.character);
                return;
            }

            const items = overrides.map(o => ({
                label: o.name,
                description: '',
                target: o
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an override to navigate to'
            });

            if (selected) {
                const target = selected.target;
                vscode.commands.executeCommand('pythonOverrideMark.navigateTo', target.uri.toString(), target.range.start.line, target.range.start.character);
            }
        })
    );
}

export function deactivate() { }
