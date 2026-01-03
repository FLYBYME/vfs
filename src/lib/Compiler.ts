import * as ts from "typescript";
import path from "path";
import { ToolFile, CompiledTool, CompilationResult } from "./types";
import { VirtualFileSystem } from "./VirtualFileSystem";

export class TypeScriptCompiler {
    private options: ts.CompilerOptions;

    // Cache for incremental builds
    private oldProgram: ts.Program | undefined;
    private sourceFileCache = new Map<string, { version: number, sourceFile: ts.SourceFile }>();

    constructor(private vfs: VirtualFileSystem, initialOptions?: Partial<ts.CompilerOptions>) {
        this.options = {
            target: ts.ScriptTarget.ES2020, // Upgrade to modern target
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            strict: true,
            declaration: true,
            skipLibCheck: true,
            esModuleInterop: true,
            removeComments: false,
            baseUrl: './',
            outDir: './out',
            sourceMap: true, // Enable source maps for debugging
            suppressOutputPathCheck: true,
            ...initialOptions
        };
    }

    /**
     * Tries to load and merge tsconfig.json from the VFS root.
     */
    public loadConfigFromVfs(): void {
        const configFile = this.vfs.read('tsconfig.json');
        if (!configFile) return;

        const { config, error } = ts.parseConfigFileTextToJson('tsconfig.json', configFile.content);
        if (error) {
            console.warn("Failed to parse tsconfig.json:", error.messageText);
            return;
        }

        // safe parsing of options without system I/O
        const parsed = ts.convertCompilerOptionsFromJson(config.compilerOptions, "./");
        if (parsed.errors.length > 0) {
            console.warn("Invalid compiler options in tsconfig.json:", parsed.errors.map(d => d.messageText));
        } else {
            this.options = { ...this.options, ...parsed.options };
        }
    }

    public generateDefinitions(fileNames: string[]): CompiledTool[] {
        const host = this.createCompilerHost();
        // Use oldProgram here as well if available to speed up type checking
        const program = ts.createProgram(fileNames, this.options, host, this.oldProgram);

        const output: CompiledTool[] = fileNames.map(name => {
            const file = this.vfs.read(name);
            return {
                name,
                content: file ? file.content : '',
                dts: '',
                js: ''
            };
        });

        program.emit(undefined, (fileName, data) => {
            const baseName = path.basename(fileName).replace(/\.d\.ts$|\.js$|\.js\.map$/, '');
            const tool = output.find(t => path.basename(t.name, '.ts') === baseName);
            if (tool) {
                if (fileName.endsWith('.d.ts')) tool.dts = data;
                if (fileName.endsWith('.js')) tool.js = data;
            }
        });

        return output;
    }

    public compileFiles(): CompilationResult {
        // Attempt to load config if we haven't explicitely set options differently? 
        // Or user can call loadConfigFromVfs() manually before this.

        const host = this.createCompilerHost();

        // Filter for .ts files, excluding .d.ts to avoid duplication in root names
        const rootNames = this.vfs.getAllFiles()
            .map(f => f.path)
            .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

        // INCREMENTAL: Pass the old program to reuse structure
        const program = ts.createProgram(rootNames, this.options, host, this.oldProgram);
        this.oldProgram = program;

        const outputFiles: { fileName: string; content: string }[] = [];

        const emitResult = program.emit(undefined, (fileName, data) => {
            // Write to VFS output
            // Calculate relative path from outDir if possible, or just standard relative
            const relativePath = path.relative(process.cwd(), fileName);
            outputFiles.push({ fileName: relativePath, content: data });
            this.vfs.write(relativePath, data);
        });

        const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

        return {
            success: !emitResult.emitSkipped && diagnostics.length === 0,
            outputFiles,
            diagnostics: this.formatDiagnostics(diagnostics)
        };
    }

    public outputFolder(): string {
        return this.options.outDir || './out';
    }

    private createCompilerHost(): ts.CompilerHost {
        const defaultHost = ts.createCompilerHost(this.options);

        return {
            ...defaultHost,
            readFile: (fileName) => {
                const vFile = this.vfs.read(fileName);
                return vFile ? vFile.content : defaultHost.readFile(fileName);
            },
            fileExists: (fileName) => {
                return this.vfs.read(fileName) !== undefined || defaultHost.fileExists(fileName);
            },
            getSourceFile: (fileName, languageVersion) => {
                const vFile = this.vfs.read(fileName);

                if (vFile) {
                    // SMART CACHING: Check version
                    const cached = this.sourceFileCache.get(fileName);
                    if (cached && cached.version === vFile.version) {
                        return cached.sourceFile;
                    }

                    // Create new source file and cache it
                    const sourceFile = ts.createSourceFile(fileName, vFile.content, languageVersion);
                    this.sourceFileCache.set(fileName, {
                        version: vFile.version,
                        sourceFile
                    });
                    return sourceFile;
                }

                // Fallback for default lib files (e.g. lib.d.ts)
                return defaultHost.getSourceFile(fileName, languageVersion);
            },
            resolveModuleNames: (moduleNames, containingFile) => {
                return moduleNames.map(moduleName => {
                    // Try to handle standard resolution
                    const result = ts.resolveModuleName(
                        moduleName,
                        containingFile,
                        this.options,
                        {
                            fileExists: (f) => this.vfs.read(f) !== undefined || defaultHost.fileExists(f),
                            readFile: (f) => {
                                const v = this.vfs.read(f);
                                return v ? v.content : defaultHost.readFile(f);
                            }
                        }
                    );
                    return result.resolvedModule;
                });
            }
        };
    }

    private formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string[] {
        return diagnostics.map(diagnostic => {
            if (diagnostic.file) {
                const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!);
                const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
                return `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`;
            }
            return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        });
    }
}