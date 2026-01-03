// VirtualFileSystem.ts
import { VirtualFile } from "./VirtualFile";
import {
    AnyGitObject,
    FileSystemSnapshot,
    GitBlob,
    GitCommit,
    GitTree,
    GitTreeEntry
} from "./types";
import path from "path";
import crypto from 'crypto';
import fs from 'fs';
import { IObjectStore, InMemoryObjectStore } from "./ObjectStore";
import { GitIgnore } from "./GitIgnore";

export interface StatusResult {
    modified: string[];
    new: string[];
    deleted: string[];
}

export class VirtualFileSystem {
    private workingFiles = new Map<string, VirtualFile>();
    private objectStore: IObjectStore;
    private refs = new Map<string, string>();
    private HEAD: string = "refs/heads/main";
    private readonly rootDir: string;

    constructor(rootDir: string = process.cwd(), objectStore?: IObjectStore) {
        this.rootDir = rootDir;
        this.objectStore = objectStore || new InMemoryObjectStore();
        this.refs.set("refs/heads/main", "");
    }

    public write(filePath: string, content: string): void {
        const absPath = this.resolve(filePath);
        if (this.workingFiles.has(absPath)) {
            this.workingFiles.get(absPath)!.update(content);
        } else {
            this.workingFiles.set(absPath, new VirtualFile(absPath, content));
        }
    }

    public delete(filePath: string): void {
        const absPath = this.resolve(filePath);
        this.workingFiles.delete(absPath);
    }

    public read(filePath: string): VirtualFile | undefined {
        return this.workingFiles.get(this.resolve(filePath));
    }

    public getAllFiles(): VirtualFile[] {
        return Array.from(this.workingFiles.values());
    }

    /**
     * Reads the contents of a directory in the current Working Directory.
     * Returns a list of file and folder names (not full paths).
     */
    public readdir(dirPath: string, options?: { recursive?: boolean, ignore?: boolean }): string[] {
        const absDir = this.resolve(dirPath);
        const entries = new Set<string>();

        const gitIgnore = this.loadGitIgnore();

        for (const filePath of this.workingFiles.keys()) {
            if (filePath.startsWith(absDir) && filePath !== absDir) {
                const relPath = path.relative(absDir, filePath);

                if (relPath.startsWith('..') || path.isAbsolute(relPath)) continue;

                if (options?.ignore && gitIgnore?.ignores(relPath)) continue;

                if (options?.recursive) {
                    entries.add(relPath.replace(/\\/g, '/'));
                } else {
                    const parts = relPath.split(path.sep);
                    entries.add(parts[0]);
                }
            }
        }

        return Array.from(entries).sort();
    }

    public async status(): Promise<StatusResult> {
        // 1. Get HEAD tree files
        let headFiles = new Map<string, string>();
        const headRef = await this.resolveRef(this.HEAD);
        if (headRef) {
            const commitObj = await this.objectStore.get(headRef);
            if (commitObj && commitObj.type === 'commit') {
                const commit = commitObj as GitCommit;
                headFiles = await this.getTreeFiles(commit.tree);
            }
        }

        // 2. Get Working files
        const workingFiles = new Map<string, string>();

        const gitIgnore = this.loadGitIgnore();

        for (const [absPath, vFile] of this.workingFiles) {
            const relPath = path.relative(this.rootDir, absPath).replace(/\\/g, '/');

            if (gitIgnore && gitIgnore.ignores(relPath)) {
                continue;
            }

            const blob = this.createBlob(vFile.content);
            workingFiles.set(relPath, blob.hash);
        }

        // 3. Compare
        const modified: string[] = [];
        const newFiles: string[] = [];
        const deleted: string[] = [];

        // Check HEAD files vs Working
        for (const [p, h] of headFiles) {
            if (!workingFiles.has(p)) {
                deleted.push(p);
            } else if (workingFiles.get(p) !== h) {
                modified.push(p);
            }
        }

        // Check New files
        for (const p of workingFiles.keys()) {
            if (!headFiles.has(p)) {
                newFiles.push(p);
            }
        }

        return { modified, new: newFiles, deleted };
    }

    public async createBranch(name: string): Promise<void> {
        const headHash = await this.resolveRef(this.HEAD);
        if (!headHash) throw new Error("HEAD is detached or invalid, cannot create branch.");

        if (this.refs.has(`refs/heads/${name}`)) {
            throw new Error(`Branch ${name} already exists.`);
        }

        this.refs.set(`refs/heads/${name}`, headHash);
    }

    public deleteBranch(name: string): void {
        if (!this.refs.has(`refs/heads/${name}`)) {
            throw new Error(`Branch ${name} does not exist.`);
        }
        if (this.HEAD === `refs/heads/${name}`) {
            throw new Error(`Cannot delete checked out branch ${name}.`);
        }
        this.refs.delete(`refs/heads/${name}`);
    }

    public async merge(branchName: string): Promise<string> {
        const theirHash = await this.resolveRef(branchName);
        if (!theirHash) throw new Error(`Branch ${branchName} not found.`);

        const ourHash = await this.resolveRef(this.HEAD);
        if (!ourHash) throw new Error("Nothing to merge into.");

        if (ourHash === theirHash) return "Already up to date.";

        const baseHash = await this.findMergeBase(ourHash, theirHash);
        if (!baseHash) throw new Error("Refusing to merge unrelated histories");

        if (baseHash === ourHash) {
            // Fast-forward
            await this.checkout(theirHash);
            return "Fast-forward";
        }

        if (baseHash === theirHash) {
            return "Already up to date.";
        }

        // 3-way merge
        await this.threeWayMerge(baseHash, ourHash, theirHash);

        // Commit merge
        await this.commit(`Merge branch '${branchName}'`, "User", [ourHash, theirHash]);
        return "Merge successful";
    }

    private async findMergeBase(hash1: string, hash2: string): Promise<string | null> {
        const ancestors1 = await this.getAncestors(hash1);
        const queue = [hash2];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (ancestors1.has(current)) return current;

            if (visited.has(current)) continue;
            visited.add(current);

            const commit = await this.objectStore.get(current);
            if (commit && commit.type === 'commit') {
                queue.push(...(commit as GitCommit).parents);
            }
        }
        return null;
    }

    private async getAncestors(startHash: string): Promise<Set<string>> {
        const set = new Set<string>();
        const queue = [startHash];
        while (queue.length > 0) {
            const h = queue.shift()!;
            if (set.has(h)) continue;
            set.add(h);
            const commit = await this.objectStore.get(h);
            if (commit && commit.type === 'commit') {
                queue.push(...(commit as GitCommit).parents);
            }
        }
        return set;
    }

    private async threeWayMerge(baseHash: string, ourHash: string, theirHash: string) {
        const baseTree = ((await this.objectStore.get(baseHash)) as GitCommit).tree;
        const ourTree = ((await this.objectStore.get(ourHash)) as GitCommit).tree;
        const theirTree = ((await this.objectStore.get(theirHash)) as GitCommit).tree;

        const baseFiles = await this.getTreeFiles(baseTree);
        const ourFiles = await this.getTreeFiles(ourTree);
        const theirFiles = await this.getTreeFiles(theirTree);

        const allFiles = new Set([...baseFiles.keys(), ...ourFiles.keys(), ...theirFiles.keys()]);

        for (const file of allFiles) {
            const baseB = baseFiles.get(file);
            const ourB = ourFiles.get(file);
            const theirB = theirFiles.get(file);

            if (ourB === theirB) continue;

            if (baseB === ourB) {
                if (theirB) {
                    const blob = await this.objectStore.get(theirB);
                    if (blob && blob.type === 'blob') {
                        this.workingFiles.set(this.resolve(file), new VirtualFile(this.resolve(file), (blob as GitBlob).content));
                    }
                } else {
                    this.workingFiles.delete(this.resolve(file));
                }
            } else if (baseB === theirB) {
                // Keep ours
            } else {
                throw new Error(`Merge conflict in ${file}`);
            }
        }
    }

    private loadGitIgnore(): GitIgnore | undefined {
        const gitIgnorePath = path.join(this.rootDir, '.gitignore');
        if (this.workingFiles.has(gitIgnorePath)) {
            return new GitIgnore(this.workingFiles.get(gitIgnorePath)!.content);
        }
        return undefined;
    }

    private async getTreeFiles(treeHash: string, basePath: string = ""): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        if (!treeHash) return result;

        const tree = await this.objectStore.get(treeHash);
        if (!tree || tree.type !== 'tree') return result;

        for (const entry of (tree as GitTree).entries) {
            const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
            if (entry.type === 'blob') {
                result.set(fullPath, entry.hash);
            } else if (entry.type === 'tree') {
                const sub = await this.getTreeFiles(entry.hash, fullPath);
                for (const [p, h] of sub) {
                    result.set(p, h);
                }
            }
        }
        return result;
    }

    /**
     * Snapshots the current working directory into a Commit object.
     */
    public async commit(message: string, author: string = "User", parents?: string[]): Promise<string> {
        const fileHashes = new Map<string, string>();

        const gitIgnore = this.loadGitIgnore();

        for (const [absPath, vFile] of this.workingFiles) {
            const relPath = path.relative(this.rootDir, absPath).replace(/\\/g, '/');

            if (gitIgnore && gitIgnore.ignores(relPath)) {
                continue;
            }

            const blob = this.createBlob(vFile.content);
            await this.storeObject(blob);
            fileHashes.set(relPath, blob.hash);
        }

        const rootTreeHash = await this.buildTreeFromPaths(fileHashes);

        let commitParents: string[];
        if (parents) {
            commitParents = parents;
        } else {
            const parentHash = await this.resolveRef(this.HEAD);
            commitParents = parentHash ? [parentHash] : [];
        }

        const commit: GitCommit = {
            type: 'commit',
            hash: '', // calculated below
            tree: rootTreeHash,
            parents: commitParents,
            message,
            author,
            timestamp: Date.now()
        };

        commit.hash = this.hashObject(commit);
        await this.storeObject(commit);

        this.updateRef(this.HEAD, commit.hash);

        return commit.hash;
    }

    /**
     * Restores the Working Directory to the state of a specific Commit or Branch.
     * This destroys uncommitted changes in the Working Directory.
     */
    public async checkout(hashOrRef: string): Promise<void> {
        const commitHash = (await this.resolveRef(hashOrRef)) || hashOrRef;

        const obj = await this.objectStore.get(commitHash);
        if (!obj || obj.type !== 'commit') {
            throw new Error(`Reference ${hashOrRef} is not a valid commit.`);
        }

        const commit = obj as GitCommit;

        this.workingFiles.clear();
        await this.restoreTree(commit.tree, this.rootDir);

        if (hashOrRef.startsWith('refs/')) {
            this.HEAD = hashOrRef;
        } else if (this.refs.has(`refs/heads/${hashOrRef}`)) {
            this.HEAD = `refs/heads/${hashOrRef}`;
        } else {
            // Detached HEAD
            this.HEAD = commitHash;
        }
    }

    /**
     * Returns the log history starting from HEAD
     */
    public async log(): Promise<GitCommit[]> {
        const history: GitCommit[] = [];
        let currentHash = await this.resolveRef(this.HEAD);

        while (currentHash) {
            const commit = await this.objectStore.get(currentHash);
            if (!commit || commit.type !== 'commit') break;

            history.push(commit as GitCommit);
            currentHash = (commit as GitCommit).parents[0] || "";
        }
        return history;
    }

    /**
     * Converts a flat map of "path -> blobHash" into a nested Merkle Tree structure.
     * Returns the hash of the Root Tree.
     */
    private buildTreeFromPaths(fileHashes: Map<string, string>): string {
        const root: any = {};

        for (const [relPath, blobHash] of fileHashes) {
            const parts = relPath.split('/');
            let current = root;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (i === parts.length - 1) {
                    // File
                    current[part] = { type: 'blob', hash: blobHash };
                } else {
                    // Directory
                    current[part] = current[part] || {};
                    current = current[part];
                }
            }
        }

        const createTreeRecursive = (node: any): string => {
            const entries: GitTreeEntry[] = [];

            for (const name of Object.keys(node)) {
                const item = node[name];
                if (item.type === 'blob') {
                    entries.push({
                        mode: "100644",
                        type: 'blob',
                        hash: item.hash,
                        name
                    });
                } else {
                    // It's a directory
                    const subtreeHash = createTreeRecursive(item);
                    entries.push({
                        mode: "040000",
                        type: 'tree',
                        hash: subtreeHash,
                        name
                    });
                }
            }

            entries.sort((a, b) => a.name.localeCompare(b.name));

            const tree: GitTree = {
                type: 'tree',
                hash: '',
                entries
            };

            tree.hash = this.hashObject(tree);
            this.storeObject(tree);
            return tree.hash;
        };

        return createTreeRecursive(root);
    }

    private async restoreTree(treeHash: string, currentBasePath: string) {
        const tree = await this.objectStore.get(treeHash);
        if (!tree || tree.type !== 'tree') throw new Error(`Missing tree ${treeHash}`);

        for (const entry of (tree as GitTree).entries) {
            const fullPath = path.join(currentBasePath, entry.name);

            if (entry.type === 'blob') {
                const blob = await this.objectStore.get(entry.hash);
                if (blob && blob.type === 'blob') {
                    this.workingFiles.set(
                        fullPath,
                        new VirtualFile(fullPath, (blob as GitBlob).content)
                    );
                }
            } else if (entry.type === 'tree') {
                await this.restoreTree(entry.hash, fullPath);
            }
        }
    }

    private createBlob(content: string): GitBlob {
        const blob: GitBlob = { type: 'blob', hash: '', content };
        blob.hash = this.hashObject(blob);
        return blob;
    }

    private hashObject(obj: Omit<AnyGitObject, 'hash'>): string {
        let content: string;
        const header = (type: string, c: string) => `${type} ${Buffer.byteLength(c)}\0`;

        if (obj.type === 'blob') {
            const blob = obj as unknown as GitBlob;
            content = blob.content;
            return crypto.createHash('sha1').update(header('blob', content) + content).digest('hex');
        } else if (obj.type === 'tree') {
            const tree = obj as unknown as GitTree;
            // deterministic sort is guaranteed by buildTreeFromPaths, but for safety we could re-sort.
            // keeping it simple as we trust the caller for now, but the serialization format is critical.
            // Format: mode type hash name
            const lines = tree.entries.map(e => `${e.mode} ${e.type} ${e.hash} ${e.name}`);
            content = lines.join('\n');
            return crypto.createHash('sha1').update(header('tree', content) + content).digest('hex');
        } else if (obj.type === 'commit') {
            const commit = obj as unknown as GitCommit;
            const lines: string[] = [];
            lines.push(`tree ${commit.tree}`);
            for (const p of commit.parents) {
                lines.push(`parent ${p}`);
            }
            lines.push(`author ${commit.author} ${commit.timestamp}`);
            lines.push(`committer ${commit.author} ${commit.timestamp}`);
            lines.push('');
            lines.push(commit.message);

            content = lines.join('\n');
            return crypto.createHash('sha1').update(header('commit', content) + content).digest('hex');
        } else {
            throw new Error(`Unknown object type: ${(obj as any).type}`);
        }
    }

    private async storeObject(obj: AnyGitObject) {
        await this.objectStore.put(obj);
    }

    private async resolveRef(ref: string): Promise<string | undefined> {
        const obj = await this.objectStore.get(ref);
        if (obj) return ref;
        if (this.refs.has(ref)) {
            return this.refs.get(ref);
        }

        const branchRef = `refs/heads/${ref}`;
        if (this.refs.has(branchRef)) {
            return this.refs.get(branchRef);
        }

        return undefined;
    }

    private updateRef(refName: string, commitHash: string) {
        // If HEAD is detached (points to a hash), update HEAD directly? 
        // Typically commits update the branch HEAD points to.

        if (refName.startsWith('refs/')) {
            this.refs.set(refName, commitHash);
        } else {
            // Detached HEAD scenario: User just moved to a new commit manually
            // Only update HEAD pointer
            this.HEAD = commitHash;
        }
    }

    private resolve(filePath: string): string {
        return path.resolve(this.rootDir, filePath);
    }

    public async getDatabaseDump() {
        return {
            objects: (await this.objectStore.dump()).map(d => [d.hash, d.object]),
            refs: Array.from(this.refs.entries()),
            HEAD: this.HEAD
        };
    }

    /**
     * Persists the entire state (History + Uncommitted Changes) to a single JSON file.
     */
    public async saveToDisk(snapshotPath: string): Promise<void> {
        const dump = await this.objectStore.dump();
        // Convert to [hash, object][] which is what FileSystemSnapshot expects
        const objects = dump.map(d => [d.hash, d.object] as [string, AnyGitObject]);
        const refs = Array.from(this.refs.entries());

        const workingFiles = Array.from(this.workingFiles.values()).map(f => ({
            path: f.path,
            content: f.content
        }));

        const snapshot: FileSystemSnapshot = {
            objects,
            refs,
            head: this.HEAD,
            workingFiles
        };

        await fs.promises.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    }

    /**
     * Loads a snapshot from disk, restoring history and uncommitted changes.
     */
    public async loadFromDisk(snapshotPath: string): Promise<void> {
        if (!fs.existsSync(snapshotPath)) {
            throw new Error(`Snapshot file not found: ${snapshotPath}`);
        }

        const data = await fs.promises.readFile(snapshotPath, 'utf-8');
        const snapshot: FileSystemSnapshot = JSON.parse(data);

        // We assume we can load into the current objectStore
        await this.objectStore.load(snapshot.objects.map(([hash, object]) => ({ hash, object })));
        this.refs = new Map(snapshot.refs);
        this.HEAD = snapshot.head;

        this.workingFiles.clear();
        for (const file of snapshot.workingFiles) {
            this.workingFiles.set(file.path, new VirtualFile(file.path, file.content));
        }
    }
}