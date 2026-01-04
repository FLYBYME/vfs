import path from 'path';
import fs from 'fs/promises';
import { VirtualFileSystem } from '../index';
import { TypeScriptCompiler } from '../index';
import { DockerSandbox } from '../index';

// 1. CONFIGURATION
// Define a persistent location on your Host machine to store the project's dependencies.
// This prevents re-downloading packages every time you run the code.
const PROJECT_ID = 'demo-project-001';
const HOST_CACHE_DIR = path.resolve(process.cwd(), '.sandbox-cache', PROJECT_ID);

async function runExample() {
    console.log(`[Setup] Using Host Cache: ${HOST_CACHE_DIR}`);

    // 2. INITIALIZE VFS
    // Create a virtual file system and populate it with user code.
    const vfs = new VirtualFileSystem();

    // A. Add package.json (Dependency)
    vfs.write('package.json', JSON.stringify({
        name: "demo-app",
        dependencies: {
            "colors": "^1.4.0", // Simple library to prove node_modules integration works
            "@types/node": "^20.10.5" // Required for 'require' to be recognized
        }
    }, null, 2));

    // B. Add TypeScript Source (Uses the dependency)
    vfs.write('src/main.ts', `
        import colors from 'colors';
        
        const message: string = "Hello from the Docker Sandbox!";
        
        console.log(colors.green(message));
        console.log(colors.blue("Timestamp: " + new Date().toISOString()));
        console.log("Files in execution dir:", require('fs').readdirSync('.'));
    `);

    // 3. INSTANTIATE TOOLS
    const sandbox = new DockerSandbox();

    // 4. STEP 1: INSTALL DEPENDENCIES
    // We check if we need to install. (In a real app, hash package.json to skip this).
    console.log('\n[Step 1] Installing Dependencies...');
    const installLogs = await sandbox.installDependencies(HOST_CACHE_DIR, vfs.read('package.json')!.content);

    if (installLogs.stderr.length > 0) {
        // npm often outputs to stderr for warnings/progress, so we just log it
        console.log('npm output:', installLogs.stderr.join('\n'));
    }

    // 5. STEP 2: COMPILE
    // Initialize compiler with the Host Cache path so it can resolve 'colors'
    console.log('\n[Step 2] Compiling TypeScript...');
    const compiler = new TypeScriptCompiler(vfs, HOST_CACHE_DIR);

    // We explicitly call loadConfig (optional, but good practice if user has tsconfig)
    // In this case, we rely on Compiler defaults + pkgRoot injection

    const compilation = compiler.compileFiles();

    if (!compilation.success) {
        console.error("❌ Compilation Failed:");
        compilation.diagnostics.forEach(d => console.error(d));
        return;
    }
    console.log("✅ Compilation Successful!");

    // Verify output exists in VFS
    const compiledFile = vfs.read('out/src/main.js');
    if (compiledFile) {
        console.log(`   Generated: out/src/main.js (${compiledFile.content.length} bytes)`);
    } else {
        console.error("   ❌ Expected output file missing in VFS");
        return;
    }

    const result = await sandbox.execute({
        vfs: vfs,
        cmd: ['ls', '-la'],
        entryPoint: 'src/main.ts', // Sandbox will auto-map this to out/src/main.js
        pkgRoot: HOST_CACHE_DIR,   // Mounts node_modules from here
        env: {
            NODE_ENV: 'production'
        }
    });
    console.log(result);
    const result2 = await sandbox.execute({
        vfs: vfs,
        cmd: ['pwd'],
        entryPoint: 'src/main.ts', // Sandbox will auto-map this to out/src/main.js
        pkgRoot: HOST_CACHE_DIR,   // Mounts node_modules from here
        env: {
            NODE_ENV: 'production'
        }
    });
    console.log(result2);

    // 6. STEP 3: EXECUTE
    console.log('\n[Step 3] Executing in Sandbox...');
    try {
        const result = await sandbox.execute({
            vfs: vfs,
            entryPoint: 'src/main.ts', // Sandbox will auto-map this to out/src/main.js
            pkgRoot: HOST_CACHE_DIR,   // Mounts node_modules from here
            env: {
                NODE_ENV: 'production'
            }
        });

        console.log('\n--- CONTAINER STDOUT ---');
        console.log(result.stdout.join('\n'));
        console.log('------------------------');

        if (result.stderr.length > 0) {
            console.log('--- CONTAINER STDERR ---');
            console.log(result.stderr.join('\n'));
        }

    } catch (error) {
        console.error("❌ Execution Error:", error);
    }
}

// Run it
runExample().catch(console.error);