
import { GitIgnore } from "../lib/GitIgnore";

describe("GitIgnore", () => {
    describe("Basic Patterns", () => {
        it("should ignore files by extension", () => {
            const gi = new GitIgnore("*.js");
            expect(gi.ignores("file.js")).toBe(true);
            expect(gi.ignores("file.ts")).toBe(false);
            expect(gi.ignores("src/file.js")).toBe(true);
        });

        it("should ignore specific files", () => {
            const gi = new GitIgnore("config.json");
            expect(gi.ignores("config.json")).toBe(true);
            expect(gi.ignores("src/config.json")).toBe(true); // Matches anywhere if no leading slash
        });

        it("should ignore rooted paths", () => {
            const gi = new GitIgnore("/config.json");
            expect(gi.ignores("config.json")).toBe(true);
            expect(gi.ignores("src/config.json")).toBe(false);
        });
    });

    describe("Directories", () => {
        it("should ignore directories", () => {
            const gi = new GitIgnore("node_modules/");
            expect(gi.ignores("node_modules/pkg/index.js")).toBe(true);
            expect(gi.ignores("src/node_modules/pkg/index.js")).toBe(true);
        });
    });

    describe("Wildcards", () => {
        it("should handle double asterisks", () => {
            const gi = new GitIgnore("src/**/*.test.ts");
            expect(gi.ignores("src/file.test.ts")).toBe(true);
            expect(gi.ignores("src/lib/file.test.ts")).toBe(true);
            expect(gi.ignores("src/file.ts")).toBe(false);
        });
    });

    describe("Negation", () => {
        it("should re-include files with !", () => {
            const gi = new GitIgnore("*.js\n!init.js");
            expect(gi.ignores("main.js")).toBe(true);
            expect(gi.ignores("init.js")).toBe(false);
        });
    });

    describe("Comments and Whitespace", () => {
        it("should ignore comments", () => {
            const gi = new GitIgnore("# This is a comment\n*.log");
            expect(gi.ignores("# This is a comment")).toBe(false);
            expect(gi.ignores("app.log")).toBe(true);
        });

        it("should ignore empty lines", () => {
            const gi = new GitIgnore("\n\n*.log\n\n");
            expect(gi.ignores("app.log")).toBe(true);
        });
    });
});
