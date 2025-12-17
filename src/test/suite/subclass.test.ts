import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { OverrideDetector } from '../../overrideDetector';
import { OverrideItem } from '../../types';

suite('Subclass Detection Unit Test Suite', () => {
    let originalExecuteCommand: any;

    setup(() => {
        originalExecuteCommand = vscode.commands.executeCommand;
    });

    test('Should ignore references in dataclass default_factory (not subclasses)', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            assert.fail('No workspace folder found');
        }
        const rootPath = workspaceFolders[0].uri.fsPath;
        const subUri = vscode.Uri.file(path.join(rootPath, 'py-sample', 'subclass.py'));

        // Mock Document Symbols: ObjectA, ObjectB, OtherObject
        const objASymbol = new vscode.DocumentSymbol(
            'ObjectA', 'detail', vscode.SymbolKind.Class,
            new vscode.Range(0, 0, 3, 0), new vscode.Range(0, 6, 0, 13)
        );

        const objBSymbol = new vscode.DocumentSymbol(
            'ObjectB', 'detail', vscode.SymbolKind.Class,
            new vscode.Range(3, 0, 6, 0), new vscode.Range(3, 6, 3, 13)
        );

        const otherSymbol = new vscode.DocumentSymbol(
            'OtherObject', 'detail', vscode.SymbolKind.Class,
            new vscode.Range(8, 0, 14, 0), new vscode.Range(8, 6, 8, 16)
        );

        // References to ObjectA/ObjectB inside OtherObject body (default_factory=ObjectA) -- should NOT be treated as subclass
        const refA = new vscode.Location(subUri, new vscode.Range(10, 20, 10, 27));
        const refB = new vscode.Location(subUri, new vscode.Range(11, 20, 11, 27));

        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            if (command === 'vscode.executeDocumentSymbolProvider') {
                const uri = args[0] as vscode.Uri;
                if (uri.toString() === subUri.toString()) return [objASymbol, objBSymbol, otherSymbol];
                return [];
            }
            if (command === 'vscode.executeReferenceProvider') {
                return [refA, refB];
            }
            return originalExecuteCommand(command, ...args);
        };

        const document = await vscode.workspace.openTextDocument(subUri);
        const editor = await vscode.window.showTextDocument(document);

        const detector = new OverrideDetector();
        const items = await detector.detectOverrides(editor);

        // There should be NO subclassed items for ObjectA/ObjectB because references are in the dataclass body
        const subclassItems = items.filter(i => i.type === 'subclassed');
        assert.strictEqual(subclassItems.length, 0, 'Should not find subclasses from default_factory references');
    });

    teardown(() => {
        (vscode.commands as any).executeCommand = originalExecuteCommand;
    });

    test('Should detect subclasses using mocked symbols', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            assert.fail('No workspace folder found');
        }
        const rootPath = workspaceFolders[0].uri.fsPath;
        const animalUri = vscode.Uri.file(path.join(rootPath, 'py-sample', 'animal.py'));
        const catUri = vscode.Uri.file(path.join(rootPath, 'py-sample', 'cat.py'));
        const dogUri = vscode.Uri.file(path.join(rootPath, 'py-sample', 'dog.py'));

        // Mock Document Symbols
        // animal.py: class Animal: (line 1)
        const animalSymbol = new vscode.DocumentSymbol(
            'Animal', 'detail', vscode.SymbolKind.Class,
            new vscode.Range(1, 0, 4, 0), new vscode.Range(1, 6, 1, 12)
        );
        // Add a method to Animal
        animalSymbol.children.push(new vscode.DocumentSymbol(
            'speak', 'detail', vscode.SymbolKind.Method,
            new vscode.Range(3, 4, 4, 0), new vscode.Range(3, 8, 3, 13)
        ));

        // cat.py: class Cats(Animal): (line 3)
        const catSymbol = new vscode.DocumentSymbol(
            'Cats', 'detail', vscode.SymbolKind.Class,
            new vscode.Range(3, 0, 9, 0), new vscode.Range(3, 6, 3, 10)
        );
        // dog.py: class Dog(Animal): (line 3)
        const dogSymbol = new vscode.DocumentSymbol(
            'Dog', 'detail', vscode.SymbolKind.Class,
            new vscode.Range(3, 0, 6, 0), new vscode.Range(3, 6, 3, 9)
        );

        // Mock References
        // cat.py: class Cats(Animal): -> Animal is at 3, 11
        const catRefRange = new vscode.Range(3, 11, 3, 17); 
        // dog.py: class Dog(Animal): -> Animal is at 3, 10
        const dogRefRange = new vscode.Range(3, 10, 3, 16);

        // Mock executeCommand
        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            if (command === 'vscode.executeDocumentSymbolProvider') {
                const uri = args[0] as vscode.Uri;
                if (uri.toString() === animalUri.toString()) return [animalSymbol];
                if (uri.toString() === catUri.toString()) return [catSymbol];
                if (uri.toString() === dogUri.toString()) return [dogSymbol];
                return [];
            }
            if (command === 'vscode.executeReferenceProvider') {
                // Return references to Animal
                return [
                    new vscode.Location(catUri, catRefRange),
                    new vscode.Location(dogUri, dogRefRange)
                ];
            }
            return originalExecuteCommand(command, ...args);
        };

        // Open the document (real file open, but we mock the symbols)
        const document = await vscode.workspace.openTextDocument(animalUri);
        const editor = await vscode.window.showTextDocument(document);

        const detector = new OverrideDetector();
        const items = await detector.detectOverrides(editor);

        // Find the subclassed item
        const subclassItem = items.find(item => item.type === 'subclassed');
        
        assert.ok(subclassItem, 'Should find a subclassed item');
        assert.strictEqual(subclassItem?.subclasses?.length, 2, 'Should find 2 subclasses');
        
        const names = subclassItem?.subclasses?.map(s => s.name).sort();
        assert.deepStrictEqual(names, ['Cats', 'Dog']);

    });
});
