
import { VirtualFileSystem } from "./lib/VirtualFileSystem";
import fs from 'fs';

async function main() {
    console.log("--- VFs 1 ---");
    const vfs = new VirtualFileSystem();
    vfs.write('main.ts', 'console.log("v1")');
    await vfs.commit('First commit');
    vfs.write('main.ts', 'console.log("v2 - uncommitted")');

    const dump1 = await vfs.getDatabaseDump();
    console.log("VFS 1 Dump Refs:", dump1.refs);
    console.log("VFS 1 Dump Objects Count:", dump1.objects.length);
    console.log("VFS 1 HEAD:", dump1.HEAD);

    await vfs.saveToDisk('./debug_backup.json');

    console.log("\n--- VFS 2 ---");
    const newVfs = new VirtualFileSystem();
    await newVfs.loadFromDisk('./debug_backup.json');

    const dump2 = await newVfs.getDatabaseDump();
    console.log("VFS 2 Dump Refs:", dump2.refs);
    console.log("VFS 2 Dump Objects Count:", dump2.objects.length);
    console.log("VFS 2 HEAD:", dump2.HEAD);

    const log = await newVfs.log();
    console.log("Log length:", log.length);
    if (log.length === 0) {
        console.log("ERROR: Log is empty!");
    } else {
        console.log("Log:", log.map(c => c.message));
    }
}

main().catch(console.error);
