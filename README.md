
# [Python Override Mark](https://marketplace.visualstudio.com/items?itemName=maxorr.python-override-mark)

<!-- [![Visual Studio Marketplace](https://img.shields.io/badge/Visual%20Studio-Marketplace-blue?logo=visual-studio-code&logoColor=white&style=flat)](https://marketplace.visualstudio.com/items?itemName=maxorr.python-override-mark) -->
[![Version](https://img.shields.io/visual-studio-marketplace/v/maxorr.python-override-mark.svg?color=green&style=?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=maxorr.python-override-mark)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/maxorr.python-override-mark.svg?color=blue&style=flat&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=maxorr.python-override-mark)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/maxorr.python-override-mark.svg?color=blue&style=flat&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=maxorr.python-override-mark)
[![Build Status](https://github.com/maxo99/vscode.python-override-mark/actions/workflows/test.yml/badge.svg)](https://github.com/maxo99/vscode.python-override-mark/actions/workflows/test.yml)
<!-- [![Rating](https://img.shields.io/visual-studio-marketplace/r/maxorr.python-override-mark.svg?color=blue&style=flat&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=maxorr.python-override-mark)
[![License](https://img.shields.io/github/license/maxo99/vscode.python-override-mark.svg?color=blue&style=flat)](https://github.com/maxo99/vscode.python-override-mark/blob/main/LICENSE) -->

Inline CodeLens indicators for overridden and implemented methods in Python.

## Technical Overview

[![TypeScript](https://shields.io/badge/TypeScript-3178C6?logo=TypeScript&logoColor=FFF)](https://www.typescriptlang.org/)
[![VS Code API](https://shields.io/badge/VS%20Code-API-007ACC?logo=visual-studio-code&logoColor=FFF)](https://code.visualstudio.com/api)

## High-Level Overview

- **Cross-File Support**: Works across your workspace.
- **Implementation Detection**: Identifies methods that are implemented/overridden by parent/subclasses.
- **CodeLens Navigation**:
  - **Overrides**: Click the "Overrides Parent.method" CodeLens to navigate to the parent definition.
  - **Implementations**: Click "Implemented in Child.method" to navigate to the subclass implementation.
  - **Multiple Implementations**: If multiple subclasses implement a method, a dropdown allows you to choose which one to navigate to.
- **Deep Inheritance Support**: Detects overrides across multiple levels of inheritance
    `Bread -> Sandwich -> Burger`

## Examples

### Inheritance CodeLens

![Inheritance CodeLens](https://raw.githubusercontent.com/maxo99/vscode.python-override-mark/main/screenshots/sample-bread.png)

### Navigation

![Click Navigation](https://raw.githubusercontent.com/maxo99/vscode.python-override-mark/main/screenshots/sample-navigation.png)

## Requirements

- The Python extension for VS Code (`ms-python.python`) must be installed and active.

## Extension Settings

| Setting                                   | Description                                                                                               |
|------------------------------------------ |---------------------------------------------------------------------------------------------------------- |
| `pythonOverrideMark.maxInheritanceDepth`  | Maximum depth to search for parent classes (recursive inheritance). Default is 3. Set to 0 for unlimited  |

## How it Works

This extension uses the VS Code Python extension's Language Server Protocol (LSP) features to analyze your code:

1. **Override Detection**: It scans the active document for class definitions and resolves their parent classes (even across files). It then compares methods to identify overrides.
2. **Implementation Detection**: It finds references to the current class to identify subclasses. It then checks those subclasses for methods that implement or override methods in the parent.
3. **Performance**: Detection is debounced (default 500ms) and optimized to skip non-class symbols to ensure a smooth editing experience.

## Future Improvements

- **Toggle Settings**: Add a setting to toggle "Parent -> Child" and "Child -> Parent" lens independently.
- **Localization**: Support multiple languages for CodeLens text.

## Contributing

Contributions are welcome!

Feel free to open an issue for bugs or feature requests, or submit a pull request.
