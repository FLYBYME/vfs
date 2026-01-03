
import { InMemoryObjectStore } from "../lib/ObjectStore";
import { GitBlob, GitCommit, GitTree } from "../lib/types";

describe("InMemoryObjectStore", () => {
    let store: InMemoryObjectStore;

    beforeEach(() => {
        store = new InMemoryObjectStore();
    });

    describe("Storage", () => {
        it("should store and retrieve a blob", async () => {
            const blob: GitBlob = { type: 'blob', hash: 'abc', content: 'test' };
            await store.put(blob);
            const retrieved = await store.get('abc');
            expect(retrieved).toEqual(blob);
        });

        it("should return undefined for missing hash", async () => {
            const retrieved = await store.get('missing');
            expect(retrieved).toBeUndefined();
        });
    });

    describe("Dump/Load", () => {
        it("should dump all objects", async () => {
            const blob1: GitBlob = { type: 'blob', hash: '1', content: 'a' };
            const blob2: GitBlob = { type: 'blob', hash: '2', content: 'b' };
            await store.put(blob1);
            await store.put(blob2);

            const dump = await store.dump();
            expect(dump).toHaveLength(2);
            expect(dump).toContainEqual({ hash: '1', object: blob1 });
            expect(dump).toContainEqual({ hash: '2', object: blob2 });
        });

        it("should load objects", async () => {
            const blob: GitBlob = { type: 'blob', hash: '1', content: 'a' };
            await store.load([{ hash: '1', object: blob }]);

            const retrieved = await store.get('1');
            expect(retrieved).toEqual(blob);
        });

        it("should clear existing data on load", async () => {
            const blob1: GitBlob = { type: 'blob', hash: '1', content: 'a' };
            await store.put(blob1);

            const blob2: GitBlob = { type: 'blob', hash: '2', content: 'b' };
            await store.load([{ hash: '2', object: blob2 }]);

            expect(await store.get('1')).toBeUndefined();
            expect(await store.get('2')).toEqual(blob2);
        });
    });
});
