import { VirtualFileSystem } from "./VirtualFileSystem";

/**
 * Abstract base for file templates.
 * T = The type of data needed to render this template.
 */
export abstract class FileTemplate<T> {
    constructor(public fileName: string) { }
    abstract render(data: T): string;
}

// --- Example: Dynamic Package.json ---
export interface PackageJsonData {
    name: string;
    dependencies: Record<string, string>;
    scripts?: Record<string, string>;
}

export class PackageJsonTemplate extends FileTemplate<PackageJsonData> {
    constructor() { super('package.json'); }

    render(data: PackageJsonData): string {
        const content = {
            name: data.name,
            version: "1.0.0",
            main: "index.js",
            scripts: data.scripts || { start: "node index.js" },
            dependencies: data.dependencies,
            devDependencies: {
                "typescript": "^5.0.0"
            }
        };
        return JSON.stringify(content, null, 2);
    }
}

// --- Example: Dynamic TSConfig ---
export class TsConfigTemplate extends FileTemplate<{ strict: boolean }> {
    constructor() { super('tsconfig.json'); }

    render(data: { strict: boolean }): string {
        return JSON.stringify({
            compilerOptions: {
                target: "ES2020",
                module: "commonjs",
                strict: data.strict,
                esModuleInterop: true
            }
        }, null, 2);
    }
}

// --- Project Scaffolder ---
export class ProjectScaffolder {
    constructor(private vfs: VirtualFileSystem) { }

    public applyTemplate<T>(template: FileTemplate<T>, data: T) {
        const content = template.render(data);
        this.vfs.write(template.fileName, content);
    }

    public scaffoldNodeProject(appName: string) {
        this.applyTemplate(new PackageJsonTemplate(), {
            name: appName,
            dependencies: { "axios": "^1.0.0" }
        });
        this.applyTemplate(new TsConfigTemplate(), { strict: true });
        this.vfs.write('src/index.ts', `console.log("Hello ${appName}");`);
    }
}