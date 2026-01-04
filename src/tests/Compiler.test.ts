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

    it("should compile multiple files", () => {
        vfs.write("src/utils.ts", 'export function add(a: number, b: number) { return a + b; }');
        vfs.write("src/main.ts", 'import { add } from "./utils"; console.log(add(1, 2));');

        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        expect(vfs.read("out/src/utils.js")).toBeDefined();
        expect(vfs.read("out/src/main.js")).toBeDefined();
    });

    it("should handle import resolution between VFS files", () => {
        vfs.write("lib/helper.ts", 'export const message = "Hello";');
        vfs.write("index.ts", 'import { message } from "./lib/helper"; console.log(message);');

        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        const compiled = vfs.read("out/index.js")?.content;
        expect(compiled).toContain('require("./lib/helper")');
    });

    it("should generate source maps", () => {
        vfs.write("main.ts", 'const x: number = 42;');

        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        expect(vfs.read("out/main.js.map")).toBeDefined();
        const sourceMap = vfs.read("out/main.js.map")?.content;
        expect(sourceMap).toContain('"sources"');
    });

    it("should support incremental compilation", () => {
        vfs.write("file1.ts", 'export const a = 1;');
        const result1 = compiler.compileFiles();
        expect(result1.success).toBe(true);

        // Add another file
        vfs.write("file2.ts", 'export const b = 2;');
        const result2 = compiler.compileFiles();

        expect(result2.success).toBe(true);
        expect(vfs.read("out/file1.js")).toBeDefined();
        expect(vfs.read("out/file2.js")).toBeDefined();
    });

    it("should handle nested directory structures", () => {
        vfs.write("src/features/auth/login.ts", 'export function login() {}');
        vfs.write("src/features/auth/logout.ts", 'export function logout() {}');

        const result = compiler.compileFiles();

        expect(result.success).toBe(true);
        expect(vfs.read("out/src/features/auth/login.js")).toBeDefined();
        expect(vfs.read("out/src/features/auth/logout.js")).toBeDefined();
    });
});
