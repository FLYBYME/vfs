
import { VirtualFileSystem, TypeScriptCompiler } from '../index';
import path from 'path';
import os from 'os';

const pkgRoot = path.join(os.tmpdir(), 'sandbox-pkg');

async function main() {
    console.log("Initializing Virtual File System...");
    const vfs = new VirtualFileSystem();

    // 1. Create a simple TypeScript file
    console.log("Writing 'src/hello.ts' to VFS...");
    vfs.write('src/hello.ts', `
export function greet(name: string): string {
    return "Hello, " + name + "!";
}

console.log(greet("World"));
    `);

    // 2. Setup the compiler
    console.log("Setting up TypeScript Compiler...");
    const compiler = new TypeScriptCompiler(vfs, pkgRoot);

    // Optional: Load config if we had a tsconfig.json
    // compiler.loadConfigFromVfs();

    // 3. Compile
    console.log("Compiling files...");
    const result = compiler.compileFiles();

    // 4. Check results
    if (result.success) {
        console.log("Compilation Successful!");
        console.log("Output Files:");
        result.outputFiles.forEach(f => {
            console.log(` - ${f.fileName}`);
            // Show content of generated JS
            if (f.fileName.endsWith('.js')) {
                console.log(`\n--- Content of ${f.fileName} ---`);
                console.log(f.content);
                console.log("-----------------------------\n");
            }
        });
    } else {
        console.error("Compilation Failed:");
        result.diagnostics.forEach(d => console.error(d));
    }
}

main().catch(err => console.error(err));
