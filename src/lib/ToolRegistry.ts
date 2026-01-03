import fs from 'fs/promises';
import path from 'path';
import { CompiledTool, ToolFile, Import } from "./types";
import { TypeScriptCompiler } from './Compiler';
import { VirtualFileSystem } from './VirtualFileSystem';

export class ToolRegistry {
    getImports(): Import[] {
        return [
            {
                name: 'cheerio',
                path: 'cheerio'
            }
        ]
    }
    private tools: CompiledTool[] = [];

    constructor(
        private compiler: TypeScriptCompiler,
        private vfs: VirtualFileSystem
    ) { }

    public async loadTools(directory: string): Promise<void> {
        const files = await fs.readdir(directory, { recursive: true });
        const tsFiles = files.filter(f => f.endsWith('.ts'));

        const toolPaths: string[] = [];

        for (const file of tsFiles) {
            const content = await fs.readFile(path.join(directory, file), 'utf-8');
            const vfsPath = 'tools/' + file;

            // Write to VFS
            this.vfs.write(vfsPath, content);
            toolPaths.push(vfsPath);
        }

        // Compile immediately to get definitions
        this.tools = this.compiler.generateDefinitions(toolPaths);
    }

    public getDefinitionsPrompt(): string {
        return this.tools.map(t =>
            `// Tool: ${t.name}\n\`\`\`typescript\n${t.dts}\n\`\`\``
        ).join('\n\n');
    }

    public getRawTools(): ToolFile[] {
        return this.tools.map(t => ({ name: t.name, content: t.content }));
    }
}