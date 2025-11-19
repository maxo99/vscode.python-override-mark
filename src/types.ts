import * as vscode from 'vscode';

export interface OverrideItem {
    type: 'override' | 'implementation';
    range: vscode.Range; // The range of the method name (source)

    // For 'override': The single parent being overridden
    parentMethodName?: string;
    parentUri?: vscode.Uri;
    parentRange?: vscode.Range;

    // For 'implementation': List of children overriding this method
    childMethods?: {
        name: string; // "ChildClass.method"
        uri: vscode.Uri;
        range: vscode.Range;
    }[];
}
