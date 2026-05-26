import * as vscode from 'vscode';
import { OverrideDetector } from './overrideDetector';
import { OverrideCodeLensProvider } from './codeLensProvider';
import { SubclassCache, ReferenceClassificationCache } from './caching';
import { OverrideGutterManager } from './gutterManager';
import { OverrideHoverProvider } from './hoverProvider';
import { OverrideInlayHintProvider } from './inlayHintProvider';
import { OverrideItem } from './types';

export function activate(context: vscode.ExtensionContext) {


    const detector = new OverrideDetector();
    const codeLensProvider = new OverrideCodeLensProvider();
    const gutterManager = new OverrideGutterManager(context.extensionUri);
    const hoverProvider = new OverrideHoverProvider();
    const inlayHintProvider = new OverrideInlayHintProvider();

    context.subscriptions.push(gutterManager);

    // Register CodeLens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'python', scheme: 'file' }, codeLensProvider),
        vscode.languages.registerHoverProvider({ language: 'python', scheme: 'file' }, hoverProvider),
        vscode.languages.registerInlayHintsProvider({ language: 'python', scheme: 'file' }, inlayHintProvider)
    );

    let activeEditor = vscode.window.activeTextEditor;
    let timeout: NodeJS.Timeout | undefined = undefined;
    let activeItems: OverrideItem[] = [];

    const updateNavigationLineContext = (items: OverrideItem[]) => {
        const allLines = [...new Set(items.map(item => item.range.start.line + 1))];

        vscode.commands.executeCommand('setContext', 'pythonOverrideMark.navigationLines', allLines);
    };

    const clearResults = () => {
        activeItems = [];
        codeLensProvider.updateResults([]);
        gutterManager.clear();
        hoverProvider.updateResults(undefined, []);
        inlayHintProvider.updateResults(undefined, []);
        updateNavigationLineContext([]);
    };

    const triggerUpdate = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        // Debounce
        const delay = vscode.workspace.getConfiguration('pythonOverrideMark').get<number>('performance.debounceDelay', 500);
        timeout = setTimeout(() => {
            const editor = activeEditor;

            if (!editor) {
                clearResults();
                return;
            }

            if (editor.document.languageId !== 'python') {
                clearResults();
                return;
            }

            // Ensure Python extension is activated
            const pythonExtension = vscode.extensions.getExtension('ms-python.python');
            if (pythonExtension && !pythonExtension.isActive) {

                pythonExtension.activate().then(() => {

                    // Re-trigger update after activation
                    triggerUpdate();
                });
                return; // Exit to avoid running detection before Python extension is ready
            }

            detector.detectOverrides(editor).then(items => {
                if (editor !== activeEditor) {
                    return;
                }

                codeLensProvider.updateResults(items);
                gutterManager.update(editor, items);
                hoverProvider.updateResults(editor, items);
                inlayHintProvider.updateResults(editor, items);
                activeItems = items;
                updateNavigationLineContext(items);
            }).catch(error => {
                if (editor === activeEditor) {
                    activeItems = [];
                    codeLensProvider.updateResults([]);
                    gutterManager.update(editor, []);
                    hoverProvider.updateResults(editor, []);
                    inlayHintProvider.updateResults(editor, []);
                    updateNavigationLineContext([]);
                }

                console.error('Error updating override marks:', error);
            });
        }, delay);
    };

    // Initial check with a slight delay to allow other extensions to start
    if (activeEditor) {
        setTimeout(triggerUpdate, 1000);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            activeEditor = editor;
            clearResults();

            if (editor) {
                triggerUpdate();
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (activeEditor && event.document === activeEditor.document) {
                triggerUpdate();
            }

            // Cache Invalidation
            // 1. Reference Classification: Always invalidate for the changed file
            ReferenceClassificationCache.getInstance().invalidateFile(event.document.uri);

            // 2. Subclass Cache: Invalidate if 'class' keyword is involved or simply clear all for safety
            // Optimization: Check if changes involve 'class' keyword
            const contentChanges = event.contentChanges;
            const involvesClass = contentChanges.some(c => c.text.includes('class') || c.text.includes('(') || c.text.includes(')'));

            if (involvesClass) {
                SubclassCache.getInstance().clear();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration('pythonOverrideMark')) {
                return;
            }

            codeLensProvider.updateResults(activeItems);

            if (event.affectsConfiguration('pythonOverrideMark.display.gutterIcons')) {
                const gutterIconsEnabled = vscode.workspace.getConfiguration('pythonOverrideMark').get<boolean>('display.gutterIcons', false);

                if (!gutterIconsEnabled) {
                    gutterManager.clear();
                }
            }

            if (activeEditor?.document.languageId === 'python') {
                triggerUpdate();
            } else {
                clearResults();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pythonOverrideMark.navigateTo', async (uriStr: string, line: number, character: number) => {

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
        vscode.commands.registerCommand('pythonOverrideMark.showOverrides', async (overrides: { name: string, uri: vscode.Uri | string, range: vscode.Range | { start: { line: number, character: number } } }[]) => {
            if (!overrides || overrides.length === 0) return;

            const normalizedOverrides = overrides.map(o => ({
                name: o.name,
                uri: typeof o.uri === 'string' ? vscode.Uri.parse(o.uri) : o.uri,
                range: o.range instanceof vscode.Range
                    ? o.range
                    : new vscode.Range(
                        new vscode.Position(o.range.start.line, o.range.start.character),
                        new vscode.Position(o.range.start.line, o.range.start.character)
                    )
            }));

            if (normalizedOverrides.length === 1) {
                const target = normalizedOverrides[0];
                vscode.commands.executeCommand('pythonOverrideMark.navigateTo', target.uri.toString(), target.range.start.line, target.range.start.character);
                return;
            }

            const items = normalizedOverrides.map(o => ({
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
        }),
        vscode.commands.registerCommand('pythonOverrideMark.navigateFromLine', async (...args: unknown[]) => {
            const { uri, lineNumber } = getLineContextArguments(args);
            const actions = getLineItems(activeEditor, activeItems, uri, lineNumber)
                .flatMap(item => getNavigationActions(item));

            if (actions.length === 0) {
                return;
            }

            if (actions.length === 1) {
                executeNavigationAction(actions[0]);
                return;
            }

            const selected = await vscode.window.showQuickPick(actions, {
                placeHolder: 'Select hierarchy navigation target'
            });

            if (selected) {
                executeNavigationAction(selected);
            }
        })
    );
}

function getLineContextArguments(args: unknown[]): { uri: vscode.Uri | undefined, lineNumber: number | undefined } {
    let uri: vscode.Uri | undefined;
    let lineNumber: number | undefined;

    for (const arg of args) {
        if (arg instanceof vscode.Uri) {
            uri = arg;
            continue;
        }

        if (typeof arg === 'number') {
            lineNumber = arg;
            continue;
        }

        if (arg && typeof arg === 'object') {
            const value = arg as { resourceUri?: vscode.Uri, uri?: vscode.Uri, lineNumber?: number, line?: number };

            if (!uri) {
                uri = value.resourceUri ?? value.uri;
            }

            if (typeof value.lineNumber === 'number') {
                lineNumber = value.lineNumber;
            } else if (typeof value.line === 'number') {
                lineNumber = value.line;
            }
        }
    }

    return { uri, lineNumber };
}

function getNavigationActions(item: OverrideItem): { label: string, description: string, command: string, arguments: unknown[] }[] {
    if (item.type === 'override' && item.parentMethodName && item.parentUri && item.parentRange) {
        return [{
            label: `$(arrow-up) ${item.parentMethodName}`,
            description: 'Overridden method',
            command: 'pythonOverrideMark.navigateTo',
            arguments: [
                item.parentUri!.toString(),
                item.parentRange!.start.line,
                item.parentRange!.start.character
            ]
        }];
    }

    if (item.type === 'implementation' && item.childMethods && item.childMethods.length > 0) {
        const count = item.childMethods.length;
        return [{
            label: count === 1 ? `$(arrow-down) ${item.childMethods[0].name}` : `$(arrow-down) ${count}`,
            description: count === 1 ? 'Implementation' : 'Implementations',
            command: 'pythonOverrideMark.showOverrides',
            arguments: [item.childMethods]
        }];
    }

    if (item.type === 'subclassed' && item.subclasses && item.subclasses.length > 0) {
        const count = item.subclasses.length;
        return [{
            label: count === 1 ? `$(arrow-down) ${item.subclasses[0].name}` : `$(arrow-down) ${count}`,
            description: count === 1 ? 'Subclass' : 'Subclasses',
            command: 'pythonOverrideMark.showOverrides',
            arguments: [item.subclasses]
        }];
    }

    return [];
}

function executeNavigationAction(action: { command: string, arguments: unknown[] }): void {
    vscode.commands.executeCommand(action.command, ...action.arguments);
}

function getLineItems(editor: vscode.TextEditor | undefined, items: OverrideItem[], uri?: vscode.Uri, lineNumber?: number): OverrideItem[] {
    if (!editor || editor.document.languageId !== 'python') {
        return [];
    }

    if (uri && uri.toString() !== editor.document.uri.toString()) {
        return [];
    }

    const zeroBasedLine = typeof lineNumber === 'number'
        ? lineNumber - 1
        : editor.selection.active.line;

    return items.filter(item => item.range.start.line === zeroBasedLine);
}

export function deactivate() { }
