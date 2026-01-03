
import { VirtualFile } from "../lib/VirtualFile";

describe("VirtualFile", () => {
    describe("Initialization", () => {
        it("should initialize with correct properties", () => {
            const file = new VirtualFile("/src/test.ts", "console.log('hello')");
            expect(file.path).toBe("/src/test.ts");
            expect(file.content).toBe("console.log('hello')");
            expect(file.version).toBe(0);
        });
    });

    describe("Language Detection", () => {
        it("should detect typescript", () => {
            const file = new VirtualFile("test.ts", "");
            expect(file.context.language).toBe("typescript");
        });

        it("should detect javascript", () => {
            const file = new VirtualFile("test.js", "");
            expect(file.context.language).toBe("javascript");
        });

        it("should detect json", () => {
            const file = new VirtualFile("test.json", "");
            expect(file.context.language).toBe("json");
        });

        it("should default to text", () => {
            const file = new VirtualFile("test.unknown", "");
            expect(file.context.language).toBe("text");
        });
    });

    describe("Analysis", () => {
        it("should parse imports", () => {
            const code = `
                import { Foo } from "./foo";
                import * as bar from "bar";
            `;
            const file = new VirtualFile("test.ts", code);
            expect(file.context.imports).toContain("./foo");
            expect(file.context.imports).toContain("bar");
        });

        it("should parse exports", () => {
            const code = `
                export { Foo } from "./foo";
                export * from "bar";
            `;
            const file = new VirtualFile("test.ts", code);
            expect(file.context.exports).toContain("./foo");
            expect(file.context.exports).toContain("bar");
        });

        it("should not parse non-ts/js files", () => {
            const file = new VirtualFile("test.txt", "import { x } from 'y'");
            expect(file.context.imports).toHaveLength(0);
        });
    });

    describe("Updates", () => {
        it("should update content and increment version", () => {
            const file = new VirtualFile("test.ts", "v1");
            file.update("v2");
            expect(file.content).toBe("v2");
            expect(file.version).toBe(1);
        });

        it("should not increment version if content is same", () => {
            const file = new VirtualFile("test.ts", "v1");
            file.update("v1");
            expect(file.version).toBe(0);
        });

        it("should re-analyze on update", () => {
            const file = new VirtualFile("test.ts", "import 'a'");
            expect(file.context.imports).toEqual(["a"]);

            file.update("import 'b'");
            expect(file.context.imports).toEqual(["b"]);
        });
    });
});
