
import { VirtualFileSystem } from "../lib/VirtualFileSystem";
import { InMemoryObjectStore } from "../lib/ObjectStore";
import fs from "fs";

// Mock fs for saveToDisk/loadFromDisk
jest.mock("fs", () => {
    const originalFs = jest.requireActual("fs");
    return {
        ...originalFs,
        promises: {
            ...originalFs.promises,
            writeFile: jest.fn(),
            readFile: jest.fn(),
        },
        existsSync: jest.fn(),
    };
});

describe("VirtualFileSystem", () => {
    let vfs: VirtualFileSystem;
    let objectStore: InMemoryObjectStore;

    beforeEach(() => {
        objectStore = new InMemoryObjectStore();
        vfs = new VirtualFileSystem("/test/root", objectStore);
        jest.clearAllMocks();
    });

    describe("Initialization", () => {
        it("should initialize with empty working files", () => {
            expect(vfs.getAllFiles()).toEqual([]);
        });
    });

    describe("File Operations", () => {
        it("should write and read a file", () => {
            vfs.write("test.txt", "hello world");
            const file = vfs.read("test.txt");
            expect(file).toBeDefined();
            expect(file?.content).toBe("hello world");
            expect(file?.path).toContain("test.txt");
        });

        it("should update an existing file", () => {
            vfs.write("test.txt", "v1");
            vfs.write("test.txt", "v2");
            const file = vfs.read("test.txt");
            expect(file?.content).toBe("v2");
            expect(file?.version).toBe(1);
        });

        it("should delete a file", () => {
            vfs.write("test.txt", "content");
            vfs.delete("test.txt");
            expect(vfs.read("test.txt")).toBeUndefined();
        });

        it("should list files in directory", () => {
            vfs.write("src/index.ts", "");
            vfs.write("src/utils/helper.ts", "");
            vfs.write("README.md", "");

            const rootFiles = vfs.readdir("");
            expect(rootFiles).toEqual(["README.md", "src"]);

            const srcFiles = vfs.readdir("src");
            expect(srcFiles).toEqual(["index.ts", "utils"]);
        });

        it("should list files recursively", () => {
            vfs.write("src/index.ts", "");
            vfs.write("src/utils/helper.ts", "");

            const files = vfs.readdir("", { recursive: true });
            expect(files).toContain("src/index.ts");
            expect(files).toContain("src/utils/helper.ts");
        });
    });

    describe("Git Operations", () => {
        it("should report status correctly", async () => {
            // New file
            vfs.write("new.txt", "new");
            let status = await vfs.status();
            expect(status.new).toContain("new.txt");
            expect(status.modified).toHaveLength(0);
            expect(status.deleted).toHaveLength(0);

            // Commit
            await vfs.commit("Initial commit");
            status = await vfs.status();
            expect(status.new).toHaveLength(0);

            // Modify
            vfs.write("new.txt", "modified");
            status = await vfs.status();
            expect(status.modified).toContain("new.txt");

            // Delete
            vfs.delete("new.txt");
            status = await vfs.status();
            expect(status.deleted).toContain("new.txt");
        });

        it("should commit and create history", async () => {
            vfs.write("file.txt", "v1");
            const commit1 = await vfs.commit("c1");

            vfs.write("file.txt", "v2");
            const commit2 = await vfs.commit("c2");

            const log = await vfs.log();
            expect(log).toHaveLength(2);
            expect(log[0].message).toBe("c2");
            expect(log[1].message).toBe("c1");
            expect(log[0].parents).toContain(commit1);
        });

        it("should checkout a commit", async () => {
            vfs.write("file.txt", "v1");
            const c1 = await vfs.commit("c1");

            vfs.write("file.txt", "v2");
            await vfs.commit("c2");

            await vfs.checkout(c1);
            expect(vfs.read("file.txt")?.content).toBe("v1");

            const log = await vfs.log();
            expect(log).toHaveLength(1); // HEAD moved
            expect(log[0].hash).toBe(c1);
        });
    });

    describe("Branching & Merging", () => {
        it("should create and delete branches", async () => {
            await vfs.commit("init"); // Need a commit to branch off
            await vfs.createBranch("feature");

            await expect(vfs.createBranch("feature")).rejects.toThrow();

            vfs.deleteBranch("feature");
            await expect(vfs.createBranch("feature")).resolves.not.toThrow();
        });

        it("should merge fast-forward", async () => {
            vfs.write("main.txt", "main");
            await vfs.commit("init");

            await vfs.createBranch("feature");
            await vfs.checkout("feature");

            vfs.write("feat.txt", "feat");
            await vfs.commit("feat commit");

            await vfs.checkout("main");
            const result = await vfs.merge("feature");

            expect(result).toBe("Fast-forward");
            expect(vfs.read("feat.txt")?.content).toBe("feat");
        });

        it("should 3-way merge without conflict", async () => {
            // 1. Init
            vfs.write("base.txt", "base");
            await vfs.commit("init");

            // 2. Feature branch
            await vfs.createBranch("feature");
            await vfs.checkout("feature");
            vfs.write("feat.txt", "feat");
            await vfs.commit("feat commit");

            // 3. Main branch (diverge)
            await vfs.checkout("main");
            vfs.write("main.txt", "main");
            await vfs.commit("main commit");

            // 4. Merge
            const result = await vfs.merge("feature");
            expect(result).toBe("Merge successful");

            expect(vfs.read("base.txt")).toBeDefined();
            expect(vfs.read("main.txt")).toBeDefined();
            expect(vfs.read("feat.txt")).toBeDefined();
        });
    });

    describe("Persistence", () => {
        it("should save to disk", async () => {
            vfs.write("test.txt", "content");
            await vfs.saveToDisk("backup.json");

            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                "backup.json",
                expect.stringContaining('test.txt'),
                "utf-8"
            );
        });

        it("should load from disk", async () => {
            // VFS stores absolute paths. In test beforeEach, root is "/test/root"
            const absPath = "/test/root/test.txt";
            const snapshot = {
                objects: [],
                refs: [],
                head: "ref/heads/main",
                workingFiles: [{ path: absPath, content: "loaded" }]
            };

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(snapshot));

            await vfs.loadFromDisk("backup.json");

            expect(vfs.read("test.txt")?.content).toBe("loaded");
        });
    });
});
