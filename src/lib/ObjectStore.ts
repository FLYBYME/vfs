import { AnyGitObject } from "./types";

export interface IObjectStore {
    get(hash: string): Promise<AnyGitObject | undefined>;
    put(obj: AnyGitObject): Promise<void>;
    dump(): Promise<{ hash: string, object: AnyGitObject }[]>;
    load(objects: { hash: string, object: AnyGitObject }[]): Promise<void>;
}

export class InMemoryObjectStore implements IObjectStore {
    private store = new Map<string, AnyGitObject>();

    async get(hash: string): Promise<AnyGitObject | undefined> {
        return this.store.get(hash);
    }

    async put(obj: AnyGitObject): Promise<void> {
        this.store.set(obj.hash, obj);
    }

    async dump(): Promise<{ hash: string, object: AnyGitObject }[]> {
        return Array.from(this.store.entries()).map(([hash, object]) => ({ hash, object }));
    }

    async load(objects: { hash: string, object: AnyGitObject }[]): Promise<void> {
        this.store.clear();
        for (const { hash, object } of objects) {
            this.store.set(hash, object);
        }
    }
}
