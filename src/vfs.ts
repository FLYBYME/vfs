import { VirtualFileSystem } from "./lib/VirtualFileSystem";
import { ProjectScaffolder } from "./lib/VirtualTemplates";
import { TypeScriptCompiler } from "./lib/Compiler";
import { DockerSandbox } from "./lib/DockerSandbox";

async function main() {
    const vfs = new VirtualFileSystem();
    // 1. Do some work
    vfs.write('main.ts', 'console.log("v1")');
    await vfs.commit('First commit');
    vfs.write('main.ts', 'console.log("v2 - uncommitted")');

    // 2. Save Snapshot
    await vfs.saveToDisk('./vfs_backup.json');

    // --- Later ---

    const newVfs = new VirtualFileSystem();
    await newVfs.loadFromDisk('./vfs_backup.json');

    // Verify uncommitted changes are present
    console.log(newVfs.read('main.ts')?.content);
    // Output: console.log("v2 - uncommitted")

    // Verify history is present
    const log = await newVfs.log();
    console.log(log);
}
main();