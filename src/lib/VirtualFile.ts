// VirtualFile.ts
import path from "path";
import * as ts from "typescript";
import { FileContext } from "./types";

export class VirtualFile {
    public readonly path: string;
    private _content: string;
    private _version: number = 0;
    public context: FileContext;

    constructor(filePath: string, content: string) {
        this.path = filePath;
        this._content = content;
        this.context = this.initializeContext(filePath);
        this.analyze();
    }

    public get content(): string { return this._content; }
    public get version(): number { return this._version; }

    public update(newContent: string) {
        if (this._content === newContent) return; // Optimization
        this._content = newContent;
        this._version++;
        this.analyze();
    }

    private initializeContext(filePath: string): FileContext {
        const ext = path.extname(filePath);
        return {
            language: ext === '.ts' || ext === '.tsx' ? 'typescript' :
                ext === '.js' || ext === '.jsx' ? 'javascript' :
                    ext === '.json' ? 'json' : 'text',
            imports: [],
            exports: [],
            diagnostics: [],
            version: 0
        };
    }

    private analyze() {
        if (this.context.language === 'typescript' || this.context.language === 'javascript') {
            this.context.ast = ts.createSourceFile(
                this.path,
                this._content,
                ts.ScriptTarget.Latest,
                true
            );

            const imports: string[] = [];
            const exports: string[] = [];

            this.context.ast.forEachChild(node => {
                // Collect Imports
                if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
                    if (ts.isStringLiteral(node.moduleSpecifier)) {
                        imports.push(node.moduleSpecifier.text);
                    }
                }
                // Collect Exports
                if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
                    if (ts.isStringLiteral(node.moduleSpecifier)) {
                        exports.push(node.moduleSpecifier.text);
                    }
                }
            });

            this.context.imports = imports;
            this.context.exports = exports;
        }
    }
}