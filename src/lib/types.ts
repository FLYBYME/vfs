import * as ts from "typescript";

export interface ToolFile {
    name: string;     // e.g., "GetWeather.ts"
    content: string;  // The raw TypeScript source
}

export interface Import {
    name: string;
    path: string;
}

export interface CompiledTool extends ToolFile {
    dts: string;      // The generated declaration file
    js: string;       // The compiled JavaScript (optional, if needed separately)
}

export interface CompilationResult {
    success: boolean;
    outputFiles: { fileName: string; content: string }[]; // .js files
    diagnostics: string[]; // Error messages
}

export interface ContainerLogs {
    stdout: string[];
    stderr: string[];
}

export interface FileContext {
    language: 'typescript' | 'javascript' | 'json' | 'text';
    imports: string[];
    exports: string[];
    diagnostics: string[];
    ast?: ts.SourceFile;
    version: number;
}

export type GitObjectType = 'blob' | 'tree' | 'commit';

export interface GitObject {
    type: GitObjectType;
    hash: string; // SHA-1
}

export interface GitBlob extends GitObject {
    type: 'blob';
    content: string;
}

export interface GitTreeEntry {
    mode: string; // "100644" for file, "040000" for tree
    type: 'blob' | 'tree';
    hash: string;
    name: string;
}

export interface GitTree extends GitObject {
    type: 'tree';
    entries: GitTreeEntry[];
}

export interface GitCommit extends GitObject {
    type: 'commit';
    tree: string;       // Hash of the root tree
    parents: string[];  // Hashes of parent commits
    message: string;
    author: string;
    timestamp: number;
}

export type AnyGitObject = GitBlob | GitTree | GitCommit;

export interface FileOperation {
    type: 'COMMIT' | 'CHECKOUT' | 'WRITE';
    message?: string;
    hash?: string;
    timestamp: number;
}

export interface FileSystemSnapshot {
    objects: [string, AnyGitObject][]; // Map serialized as array
    refs: [string, string][];          // Map serialized as array
    head: string;
    workingFiles: { path: string; content: string }[];
}