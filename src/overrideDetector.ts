import * as vscode from 'vscode';
import { OverrideItem } from './types';

export class OverrideDetector {
    public async detectOverrides(editor: vscode.TextEditor): Promise<OverrideItem[]> {
        const document = editor.document;

        // Only process Python files
        if (document.languageId !== 'python') {
            return [];
        }

        let symbols: vscode.DocumentSymbol[] | undefined;
        let retries = 10; // Increase retries
        let attempt = 0;

        while (attempt < retries) {
            try {
                symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    document.uri
                );

                if (symbols && symbols.length > 0) {
                    break;
                }

            } catch (e: any) {
                const msg = e.message || '';
                if (msg.includes('LanguageServerClient must be initialized first') || msg.includes('Language server is not ready')) {
                    // Wait
                } else {
                    console.error('[OverrideMark] Error getting symbols:', e);
                }
            }

            attempt++;
            if (attempt < retries) {
                // Exponential backoff or fixed delay
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (!symbols || symbols.length === 0) {
            return [];
        }

        const results: OverrideItem[] = [];

        // Map to store potential parent methods: "ClassName.MethodName" -> Location
        const classMethods = new Map<string, vscode.Location>();

        // First pass: Index all class methods in the current file
        const indexMethods = (symbol: vscode.DocumentSymbol, className: string) => {
            for (const child of symbol.children) {
                if (child.kind === vscode.SymbolKind.Method) {
                    classMethods.set(`${className}.${child.name}`, new vscode.Location(document.uri, child.selectionRange));
                }
            }
        };

        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                indexMethods(symbol, symbol.name);
            }
        }

        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                await this.processClass(document, symbol, results, classMethods);
            }
        }

        return results;
    }

    private async processClass(
        document: vscode.TextDocument,
        classSymbol: vscode.DocumentSymbol,
        results: OverrideItem[],
        localClassMethods: Map<string, vscode.Location>
    ) {
        // 1. Identify parent classes (Recursive BFS)
        const maxDepth = vscode.workspace.getConfiguration('pythonOverrideMark').get<number>('maxInheritanceDepth', 3);

        // Map: MethodName -> { loc, className }
        // We want the CLOSEST parent method.
        const parentMethods = new Map<string, { loc: vscode.Location, className: string }>();

        const visited = new Set<string>();
        // Key for visited: uri:className
        visited.add(`${document.uri.toString()}:${classSymbol.name}`);

        // Queue: { symbol, uri, depth }
        const queue: { symbol: vscode.DocumentSymbol, uri: vscode.Uri, depth: number }[] = [];

        // Initial parents
        const initialParents = await this.resolveParents(document, classSymbol);
        for (const p of initialParents) {
            queue.push({ symbol: p.symbol, uri: p.uri, depth: 1 });
        }

        while (queue.length > 0) {
            const { symbol: currentSymbol, uri: currentUri, depth } = queue.shift()!;
            const key = `${currentUri.toString()}:${currentSymbol.name}`;

            if (visited.has(key)) continue;
            visited.add(key);

            // Collect methods
            for (const child of currentSymbol.children) {
                if (child.kind === vscode.SymbolKind.Method) {
                    // Only add if not already present (closest wins)
                    if (!parentMethods.has(child.name)) {
                        parentMethods.set(child.name, {
                            loc: new vscode.Location(currentUri, child.selectionRange),
                            className: currentSymbol.name
                        });
                    }
                }
            }

            // Recurse if depth allows
            if (maxDepth === 0 || depth < maxDepth) {
                try {
                    let doc: vscode.TextDocument;
                    if (currentUri.toString() === document.uri.toString()) {
                        doc = document;
                    } else {
                        doc = await vscode.workspace.openTextDocument(currentUri);
                    }

                    const nextParents = await this.resolveParents(doc, currentSymbol);
                    for (const p of nextParents) {
                        queue.push({ symbol: p.symbol, uri: p.uri, depth: depth + 1 });
                    }
                } catch (e) {
                    console.error(`[OverrideMark] Failed to resolve parents for ${currentSymbol.name}:`, e);
                }
            }
        }

        // 3. Check current class methods against parent methods (Override Detection)
        // Map to aggregate implementations: ParentMethodKeyString -> { parentRange: Range, children: ChildInfo[] }
        const implementations = new Map<string, { parentRange: vscode.Range, children: { name: string, uri: vscode.Uri, range: vscode.Range }[] }>();

        for (const child of classSymbol.children) {
            if (child.kind === vscode.SymbolKind.Method) {
                // Only check for overrides if we have parent methods
                if (parentMethods.size > 0 && parentMethods.has(child.name)) {
                    const parentInfo = parentMethods.get(child.name);
                    if (parentInfo) {
                        results.push({
                            type: 'override',
                            range: child.selectionRange,
                            parentMethodName: `${parentInfo.className}.${child.name}`,
                            parentUri: parentInfo.loc.uri,
                            parentRange: parentInfo.loc.range
                        });
                    }
                }
            }
        }

        // 5. Subclass Detection (Reference Based)
        // We find references to the current class to identify subclasses
        const subclasses = await this.findSubclasses(document, classSymbol);

        for (const { symbol: subclassSymbol, uri: subclassUri } of subclasses) {
            for (const child of subclassSymbol.children) {
                if (child.kind === vscode.SymbolKind.Method) {
                    // Check if this method overrides a method in the current class (Animal)
                    const animalMethod = classSymbol.children.find(c => c.name === child.name && c.kind === vscode.SymbolKind.Method);

                    if (animalMethod) {
                        const parentKey = `${animalMethod.range.start.line}:${animalMethod.range.start.character}`;
                        if (!implementations.has(parentKey)) {
                            implementations.set(parentKey, { parentRange: animalMethod.selectionRange, children: [] });
                        }

                        // Avoid duplicates if we somehow process the same thing twice
                        const children = implementations.get(parentKey)!.children;
                        // We don't have a unique ID in the children array, so let's just check if we have one with same URI and range
                        const exists = children.some(c => c.uri.toString() === subclassUri.toString() && c.range.isEqual(child.selectionRange));

                        if (!exists) {
                            children.push({
                                name: `${subclassSymbol.name}.${child.name}`,
                                uri: subclassUri,
                                range: child.selectionRange
                            });
                        }
                    }
                }
            }
        }

        // Convert aggregated implementations to results
        for (const item of implementations.values()) {
            if (item.children.length > 0) {
                results.push({
                    type: 'implementation',
                    range: item.parentRange,
                    childMethods: item.children
                });
            }
        }
    }

    private async resolveParents(document: vscode.TextDocument, classSymbol: vscode.DocumentSymbol): Promise<{ symbol: vscode.DocumentSymbol, uri: vscode.Uri }[]> {
        const results: { symbol: vscode.DocumentSymbol, uri: vscode.Uri }[] = [];
        const locs = await this.findParentLocations(document, classSymbol);

        for (const loc of locs) {
            try {
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    loc.uri
                );
                if (symbols) {
                    const sym = this.findSymbolAtLocation(symbols, loc.range);
                    if (sym) {
                        results.push({ symbol: sym, uri: loc.uri });
                    }
                }
            } catch (e) {
                console.error(`[OverrideMark] Error resolving parent symbol at ${loc.uri}:`, e);
            }
        }
        return results;
    }

    private async findSubclasses(document: vscode.TextDocument, classSymbol: vscode.DocumentSymbol): Promise<{ symbol: vscode.DocumentSymbol, uri: vscode.Uri }[]> {
        const subclasses: { symbol: vscode.DocumentSymbol, uri: vscode.Uri }[] = [];
        try {
            const refs = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                classSymbol.selectionRange.start // Name of the class
            );

            if (!refs) {
                return [];
            }

            // Group by URI to avoid opening the same doc multiple times
            const refsByUri = new Map<string, vscode.Range[]>();
            for (const ref of refs) {
                const uriStr = ref.uri.toString();
                if (!refsByUri.has(uriStr)) {
                    refsByUri.set(uriStr, []);
                }
                refsByUri.get(uriStr)?.push(ref.range);
            }

            for (const [uriStr, ranges] of refsByUri) {
                const uri = vscode.Uri.parse(uriStr);

                let doc: vscode.TextDocument;
                try {
                    if (uri.toString() === document.uri.toString()) {
                        doc = document;
                    } else {
                        doc = await vscode.workspace.openTextDocument(uri);
                    }
                } catch (e) {
                    console.error(`[OverrideMark] Failed to open document ${uriStr}`, e);
                    continue;
                }

                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    uri
                );
                if (!symbols) continue;

                for (const range of ranges) {
                    // Find the symbol that contains this reference
                    const enclosingSymbol = this.getSymbolContaining(symbols, range);

                    // Check if the enclosing symbol is a class and the reference is in the inheritance list
                    if (enclosingSymbol && enclosingSymbol.kind === vscode.SymbolKind.Class) {
                        // To confirm it's in the inheritance list (and not a class attribute),
                        // we check if the reference is inside the class definition parentheses.
                        // We read text from the class start to the reference start.
                        const textBefore = this.getTextRange(doc, enclosingSymbol.range.start, range.start);

                        // Count open parentheses to see if we are inside the class definition
                        let openParens = 0;
                        for (const char of textBefore) {
                            if (char === '(') openParens++;
                            if (char === ')') openParens--;
                        }

                        // If we have more open parens, we are likely in the inheritance list: class Child(Parent...
                        if (openParens > 0) {
                            // Avoid duplicates
                            if (!subclasses.some(s => s.symbol.name === enclosingSymbol.name && s.uri.toString() === uriStr)) {
                                subclasses.push({ symbol: enclosingSymbol, uri });
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.error('[OverrideMark] Error finding subclasses:', e);
        }
        return subclasses;
    }

    private getSymbolContaining(symbols: vscode.DocumentSymbol[], range: vscode.Range): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.contains(range)) {
                const child = this.getSymbolContaining(symbol.children, range);
                if (child) return child;
                return symbol;
            }
        }
        return undefined;
    }

    private getTextRange(document: vscode.TextDocument, start: vscode.Position, end: vscode.Position): string {
        return document.getText(new vscode.Range(start, end));
    }

    private findClassSymbol(symbols: vscode.DocumentSymbol[], name: string): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class && symbol.name === name) {
                return symbol;
            }
            if (symbol.children) {
                const found = this.findClassSymbol(symbol.children, name);
                if (found) return found;
            }
        }
        return undefined;
    }

    private async findParentLocations(document: vscode.TextDocument, classSymbol: vscode.DocumentSymbol): Promise<vscode.Location[]> {
        const locations: vscode.Location[] = [];

        // Optimization: Ensure the symbol actually looks like a class definition
        // (LSP sometimes returns imports as Class symbols)
        const nameLine = document.lineAt(classSymbol.selectionRange.start.line).text;
        if (!/\bclass\b/.test(nameLine)) {
            return [];
        }

        // Read the class definition header (handling multi-line)
        // We accumulate text until we find the colon that starts the body
        let headerText = '';
        let lineIdx = classSymbol.range.start.line;
        let maxLines = 20; // Safety limit
        let linesRead = 0;

        while (lineIdx < document.lineCount && linesRead < maxLines) {
            const line = document.lineAt(lineIdx).text;
            // Remove comments for cleaner parsing
            const commentIndex = line.indexOf('#');
            const cleanLine = commentIndex >= 0 ? line.substring(0, commentIndex) : line;

            headerText += cleanLine + '\n';

            if (cleanLine.trim().endsWith(':')) {
                break;
            }
            lineIdx++;
            linesRead++;
        }

        // Regex to find content inside parentheses: class Name(...)
        // [\s\S]*? matches any character including newlines non-greedily
        const match = /class\s+\w+\s*\(([\s\S]*?)\)/.exec(headerText);

        if (match && match[1]) {
            // Split by comma, but be careful about nested parens
            const parents = match[1].split(',').map(p => p.trim()).filter(p => p.length > 0);

            for (const parent of parents) {
                // We need to find the position of this parent string in the document to resolve it.
                let currentLineIdx = classSymbol.range.start.line;
                let found = false;

                // Create a regex to find the parent name as a whole word
                // Escape special regex characters in parent name just in case
                const escapedParent = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const parentRegex = new RegExp(`\\b${escapedParent}\\b`);

                // Search line by line
                while (currentLineIdx <= lineIdx) {
                    const lineText = document.lineAt(currentLineIdx).text;
                    const match = parentRegex.exec(lineText);

                    if (match) {
                        // Found it
                        const parentIdx = match.index;
                        const pos = new vscode.Position(currentLineIdx, parentIdx);
                        try {
                            const definition = await vscode.commands.executeCommand<vscode.Location | vscode.Location[] | vscode.LocationLink[]>(
                                'vscode.executeDefinitionProvider',
                                document.uri,
                                pos
                            );

                            if (definition) {
                                if (Array.isArray(definition)) {
                                    if (definition.length > 0) {
                                        const first = definition[0];
                                        if ('targetUri' in first) {
                                            locations.push(new vscode.Location(first.targetUri, first.targetRange));
                                        } else {
                                            locations.push(first as vscode.Location);
                                        }
                                    }
                                } else {
                                    locations.push(definition as vscode.Location);
                                }
                            }
                        } catch (e) {
                            console.error(`[OverrideMark] Error resolving parent ${parent}:`, e);
                        }
                        found = true;
                        break; // Move to next parent
                    }
                    currentLineIdx++;
                }
            }
        }
        return locations;
    }

    private findSymbolAtLocation(symbols: vscode.DocumentSymbol[], range: vscode.Range): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.contains(range.start)) {
                if (symbol.children.length > 0) {
                    const child = this.findSymbolAtLocation(symbol.children, range);
                    if (child) return child;
                }
                if (symbol.kind === vscode.SymbolKind.Class) {
                    return symbol;
                }
            }
        }
        return undefined;
    }
}
