import { VirtualFileSystem } from "../lib/VirtualFileSystem";
import { TypeScriptCompiler } from "../lib/Compiler";
import path from "path";
import os from "os";

describe("TypeScriptCompiler", () => {
    let vfs: VirtualFileSystem;
    let compiler: TypeScriptCompiler;
    const pkgRoot = path.join(os.tmpdir(), "vfs-test-pkg-root");

    beforeEach(() => {
        // Use a consistent absolute root for the VFS in tests
        vfs = new VirtualFileSystem("/project");
        compiler = new TypeScriptCompiler(vfs, pkgRoot);
    });

    it("should compile simple TS code and write JS to VFS", () => {
        vfs.write("main.ts", 'const x: number = 42; console.log(x);');

        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        expect(result.outputFiles.length).toBeGreaterThan(0);

        // Relative paths in VFS should be handled correctly
        const compiledFile = vfs.read("out/main.js");
        expect(compiledFile).toBeDefined();
        expect(compiledFile?.content).toContain("const x = 42;");
    });

    it("should report diagnostics for invalid code", () => {
        vfs.write("error.ts", 'const x: number = "not a number";');

        const result = compiler.compileFiles();

        expect(result.success).toBe(false);
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics[0]).toContain("is not assignable to type 'number'");
    });

    it("should handle virtual absolute paths", () => {
        vfs.write("/src/main.ts", 'const x = 1;');

        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        // outDir is joined with vfs.rootDir, so out/src/main.js is expected
        expect(vfs.read("out/src/main.js")).toBeDefined();
    });

    it("should merge options from tsconfig.json in VFS", () => {
        vfs.write("tsconfig.json", JSON.stringify({
            compilerOptions: {
                removeComments: true
            }
        }));
        vfs.write("main.ts", "// comment\nconst x = 1;");

        compiler.loadConfigFromVfs();
        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        const compiled = vfs.read("out/main.js")?.content;
        expect(compiled).not.toContain("// comment");
    });
});
