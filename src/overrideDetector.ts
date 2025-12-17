import * as vscode from 'vscode';
import { OverrideItem } from './types';
import { SubclassCache, ReferenceClassificationCache } from './caching';

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

        const isLib = this.isLibraryFile(document);

        for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Class) {
                await this.processClass(document, symbol, results, classMethods, isLib);
            }
        }

        return results;
    }

    private isLibraryFile(document: vscode.TextDocument): boolean {
        const uri = document.uri;
        if (uri.scheme !== 'file') {
            return true;
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return true;
        }
        const path = uri.fsPath;
        // Check for common virtual environment and library paths
        if (path.includes('.venv') || path.includes('site-packages') || path.includes('dist-packages') || path.includes('node_modules')) {
            return true;
        }
        return false;
    }

    private async processClass(
        document: vscode.TextDocument,
        classSymbol: vscode.DocumentSymbol,
        results: OverrideItem[],
        localClassMethods: Map<string, vscode.Location>,
        isLibraryFile: boolean
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
        let subclasses: { symbol: vscode.DocumentSymbol, uri: vscode.Uri }[] = [];

        if (!isLibraryFile) {
            subclasses = await this.findSubclasses(document, classSymbol);

            if (subclasses.length > 0) {
                results.push({
                    type: 'subclassed',
                    range: classSymbol.selectionRange,
                    subclasses: subclasses.map(s => ({
                        name: s.symbol.name,
                        uri: s.uri,
                        range: s.symbol.selectionRange
                    }))
                });
            }
        }

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
        const subclassCache = SubclassCache.getInstance();
        const cached = subclassCache.get(document.uri, classSymbol.name);
        if (cached) {
            return cached;
        }

        const subclasses: { symbol: vscode.DocumentSymbol, uri: vscode.Uri }[] = [];
        const refCache = ReferenceClassificationCache.getInstance();

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
                // Check reference cache first
                const isSubclass = refCache.get(ref.uri, ref.range);
                if (isSubclass === false) {
                    continue; // Known non-subclass
                }

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
                    let isSubclassRef = false;

                    // Find the symbol that contains this reference
                    const enclosingSymbol = this.getSymbolContaining(symbols, range);

                    // Check if the enclosing symbol is a class and the reference is in the inheritance list
                    if (enclosingSymbol && enclosingSymbol.kind === vscode.SymbolKind.Class) {
                        // To confirm it's in the inheritance list (and not a class attribute like
                        // default_factory=SomeClass), we check whether the reference occurs in the
                        // class header (the part up to the trailing ':' of the class declaration)
                        // and whether parentheses are open at that point. This avoids counting
                        // references inside the class body (e.g. default_factory=ClassName).
                        if (this.isReferenceInClassHeader(doc, enclosingSymbol, range)) {
                            isSubclassRef = true;
                            // Avoid duplicates
                            if (!subclasses.some(s => s.symbol.name === enclosingSymbol.name && s.uri.toString() === uriStr)) {
                                subclasses.push({ symbol: enclosingSymbol, uri });
                            }
                        }
                    }

                    // Update reference cache
                    refCache.set(uri, range, isSubclassRef);
                }
            }

            // Update subclass cache
            subclassCache.set(document.uri, classSymbol.name, subclasses);

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

    private isReferenceInClassHeader(document: vscode.TextDocument, enclosingSymbol: vscode.DocumentSymbol, range: vscode.Range): boolean {
        // Read the class definition header (handling multi-line) up to the ':' that starts the body
        let lineIdx = enclosingSymbol.range.start.line;
        let linesRead = 0;
        const maxLines = 50;
        let headerEndLine = -1;
        let headerEndChar = -1;

        while (lineIdx < document.lineCount && linesRead < maxLines) {
            const line = document.lineAt(lineIdx).text;
            const commentIndex = line.indexOf('#');
            const cleanLine = commentIndex >= 0 ? line.substring(0, commentIndex) : line;

            if (cleanLine.trim().endsWith(':')) {
                headerEndLine = lineIdx;
                headerEndChar = cleanLine.length; // treat end of line as header end
                break;
            }

            lineIdx++;
            linesRead++;
        }

        if (headerEndLine === -1) {
            return false;
        }

        // If the reference is after the header end, it's not in the inheritance list
        if (range.start.line > headerEndLine) return false;
        if (range.start.line === headerEndLine && range.start.character >= headerEndChar) return false;

        // Count parentheses between class start and the reference position but only within header
        let openParens = 0;
        for (let ln = enclosingSymbol.range.start.line; ln <= range.start.line; ln++) {
            let text = document.lineAt(ln).text;
            const commentIndex = text.indexOf('#');
            if (commentIndex >= 0) text = text.substring(0, commentIndex);

            if (ln === range.start.line) {
                text = text.substring(0, range.start.character);
            }

            for (const ch of text) {
                if (ch === '(') openParens++;
                if (ch === ')') openParens--;
            }
        }

        return openParens > 0;
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
