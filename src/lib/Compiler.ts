import * as ts from "typescript";
import path from "path";
import fs from "fs";
import { ToolFile, CompiledTool, CompilationResult } from "./types";
import { VirtualFileSystem } from "./VirtualFileSystem";

export class TypeScriptCompiler {
    private options: ts.CompilerOptions;

    // Cache for incremental builds
    private oldProgram: ts.Program | undefined;
    private sourceFileCache = new Map<string, { version: number, sourceFile: ts.SourceFile }>();

    /**
     * @param vfs The Virtual File System instance.
     * @param pkgRoot The absolute path on the HOST where node_modules are located (managed by DockerSandbox).
     * @param initialOptions Optional overrides.
     */
    constructor(
        private vfs: VirtualFileSystem,
        private pkgRoot: string,
        initialOptions?: Partial<ts.CompilerOptions>
    ) {
        this.options = {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            strict: true,
            declaration: true,
            skipLibCheck: true,
            esModuleInterop: true,
            removeComments: false,
            sourceMap: true,
            suppressOutputPathCheck: true,

            // Critical: Force source structure to match output structure
            rootDir: this.vfs.rootDir,
            outDir: path.join(this.vfs.rootDir, 'out'),

            // Critical: Point resolution to the external pkgRoot
            baseUrl: this.vfs.rootDir,
            paths: {
                "*": [path.join(this.pkgRoot, "node_modules", "*")]
            },
            typeRoots: [
                path.join(this.pkgRoot, "node_modules", "@types")
            ],

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

        const parsed = ts.convertCompilerOptionsFromJson(config.compilerOptions, this.vfs.rootDir);
        if (parsed.errors.length > 0) {
            console.warn("Invalid compiler options in tsconfig.json:", parsed.errors.map(d => d.messageText));
        } else {
            // Merge user config, but ensure we keep our critical path/root overrides unless explicitly changed
            this.options = { ...this.options, ...parsed.options };

            // Re-enforce pkgRoot paths if the user didn't provide custom paths
            if (!parsed.options.paths) {
                this.options.paths = { "*": [path.join(this.pkgRoot, "node_modules", "*")] };
            }
            if (!parsed.options.typeRoots) {
                this.options.typeRoots = [path.join(this.pkgRoot, "node_modules", "@types")];
            }
        }
    }

    public generateDefinitions(fileNames: string[]): CompiledTool[] {
        const host = this.createCompilerHost();
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
            // Clean up filenames to match tool names
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
        const host = this.createCompilerHost();

        const rootNames = this.vfs.getAllFiles()
            .map(f => f.path)
            .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

        const program = ts.createProgram(rootNames, this.options, host, this.oldProgram);
        this.oldProgram = program;

        const outputFiles: { fileName: string; content: string }[] = [];

        const emitResult = program.emit(undefined, (fileName, data) => {
            // fileName comes back as absolute path usually, or relative to cwd.
            // We want it relative to the VFS root.
            const relativePath = path.relative(this.vfs.rootDir, fileName);

            // Normalize slashes for VFS consistency
            const normalizedPath = relativePath.split(path.sep).join('/');

            outputFiles.push({ fileName: normalizedPath, content: data });
            this.vfs.write(normalizedPath, data);
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

            // 1. READ FILE: VFS -> External Cache -> Default Libs
            readFile: (fileName: string) => {
                // A. Check VFS
                const vFile = this.vfs.read(fileName);
                if (vFile) return vFile.content;

                // B. Check External Package Root (pkgRoot)
                // We use real fs here because these files exist on the host disk
                if (fileName.includes(this.pkgRoot)) {
                    try {
                        if (fs.existsSync(fileName)) {
                            return fs.readFileSync(fileName, 'utf-8');
                        }
                    } catch (e) { /* ignore */ }
                }

                // C. Check Default Libs (e.g. lib.d.ts inside the running node_modules)
                if (fileName.includes('typescript/lib')) {
                    return defaultHost.readFile(fileName);
                }

                return undefined;
            },

            // 2. FILE EXISTS
            fileExists: (fileName: string) => {
                if (this.vfs.read(fileName) !== undefined) return true;
                if (fileName.includes(this.pkgRoot) && fs.existsSync(fileName)) return true;
                if (fileName.includes('typescript/lib') && defaultHost.fileExists(fileName)) return true;
                return false;
            },

            // 3. GET SOURCE FILE (with Caching)
            getSourceFile: (fileName, languageVersion) => {
                const vFile = this.vfs.read(fileName);

                if (vFile) {
                    const cached = this.sourceFileCache.get(fileName);
                    if (cached && cached.version === vFile.version) {
                        return cached.sourceFile;
                    }

                    const sourceFile = ts.createSourceFile(fileName, vFile.content, languageVersion);
                    this.sourceFileCache.set(fileName, {
                        version: vFile.version,
                        sourceFile
                    });
                    return sourceFile;
                }

                // Fallback for external libs
                // We must explicitly use fs for external libs if defaultHost fails or to ensure we look in pkgRoot
                if (fileName.includes(this.pkgRoot)) {
                    const content = fs.readFileSync(fileName, 'utf-8');
                    return ts.createSourceFile(fileName, content, languageVersion);
                }

                return defaultHost.getSourceFile(fileName, languageVersion);
            },

            // 4. RESOLVE MODULES: VFS First -> External Second
            resolveModuleNames: (moduleNames, containingFile, reusedNames, redirectedReference, options) => {
                return moduleNames.map(moduleName => {
                    // A. VFS Resolution (Relative imports, e.g., "./utils")
                    const vfsResult = ts.resolveModuleName(
                        moduleName,
                        containingFile,
                        options,
                        {
                            fileExists: (f) => this.vfs.read(f) !== undefined,
                            readFile: (f) => this.vfs.read(f)?.content
                        }
                    );
                    if (vfsResult.resolvedModule) return vfsResult.resolvedModule;

                    // B. External Resolution (Libraries, e.g., "axios")
                    // We force resolution against the pkgRoot
                    const externalResult = ts.resolveModuleName(
                        moduleName,
                        containingFile,
                        {
                            ...options,
                            baseUrl: this.pkgRoot,
                            paths: { "*": ["node_modules/*"] }
                        },
                        defaultHost
                    );

                    return externalResult.resolvedModule;
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