# Python Override Mark

Visual and interactive indicators for overridden methods in Python.

## Features

- **Override Detection**: Automatically detects methods that override a parent class method.
- **Implementation Detection**: Identifies methods in parent classes that are implemented/overridden by subclasses.
- **CodeLens Navigation**:
    - **Overrides**: Click the "Overrides Parent.method" CodeLens to navigate to the parent definition.
    - **Implementations**: Click "Implemented in Child.method" to navigate to the subclass implementation.
    - **Multiple Implementations**: If multiple subclasses implement a method, a dropdown allows you to choose which one to navigate to.
- **Deep Inheritance Support**: Detects overrides across multiple levels of inheritance (e.g., Grandchild -> Child -> Parent).
- **Cross-File Support**: Works across different files in your workspace.

## Why use this extension?

Unlike other extensions that use small gutter icons, **Python Override Mark** uses **CodeLens** (inline text) to provide clear, actionable context right above your methods.

- **Glanceable**: See immediately *which* class you are overriding (`Overrides Animal.speak`) without hovering.
- **Interactive**: One click to jump to the parent definition or child implementation.
- **Trustworthy**: Open Source and built specifically for VS Code.

## Requirements

- The Python extension for VS Code (`ms-python.python`) must be installed and active.

## Extension Settings

This extension contributes the following settings:

* `pythonOverrideMark.maxInheritanceDepth`: Maximum depth to search for parent classes (recursive inheritance). Default is 3. Set to 0 for unlimited.

## How it Works

This extension uses the VS Code Python extension's Language Server Protocol (LSP) features to analyze your code:

1.  **Override Detection**: It scans the active document for class definitions and resolves their parent classes (even across files). It then compares methods to identify overrides.
2.  **Implementation Detection**: It finds references to the current class to identify subclasses. It then checks those subclasses for methods that implement or override methods in the parent.
3.  **Performance**: Detection is debounced (default 500ms) and optimized to skip non-class symbols to ensure a smooth editing experience.
