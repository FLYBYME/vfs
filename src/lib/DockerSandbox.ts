import Dockerode from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ContainerLogs } from "./types";
import { VirtualFileSystem } from './VirtualFileSystem';

export interface DockerSandboxOptions {
    vfs: VirtualFileSystem;
    entryPoint: string; // Path string (e.g. "src/index.ts")
    pkgRoot: string;    // Absolute path on HOST where node_modules cache resides
    timeoutMs?: number;
    env?: Record<string, string>;
    memoryLimit?: number;
    cpuLimit?: number;
    cmd?: string[];
}

export class DockerSandbox {
    private docker = new Dockerode();
    // Use a standard Node image that includes npm
    private static IMAGE = 'node:18-alpine';

    /**
     * 1. INSTALL STAGE
     * Creates a container solely to run `npm install` into a persistent host folder.
     * This folder (pkgRoot) is later mounted into the execution container and the compiler.
     */
    public async installDependencies(pkgRoot: string, packageJsonContent: string): Promise<ContainerLogs> {
        // Ensure host directory exists
        await fs.mkdir(pkgRoot, { recursive: true });

        // Write package.json to the host cache dir
        await fs.writeFile(path.join(pkgRoot, 'package.json'), packageJsonContent);

        // Run container to install dependencies
        // Mount: Host(pkgRoot) -> Container(/sandbox/pkg) [Read-Write]
        const container = await this.docker.createContainer({
            Image: DockerSandbox.IMAGE,
            Cmd: ['npm', 'install'],
            WorkingDir: '/sandbox/pkg',
            HostConfig: {
                Binds: [`${pkgRoot}:/sandbox/pkg:rw`],
                AutoRemove: true,
                // Give npm enough memory
                Memory: 512 * 1024 * 1024
            }
        });

        await container.start();

        // npm install might take a while, give it 60s
        return this.captureLogs(container, 60000);
    }

    /**
     * 2. EXECUTE STAGE
     * Runs the user code.
     * - Mounts the code from a temp dir.
     * - Mounts the node_modules from the persistent cache (pkgRoot).
     */
    public async execute(
        options: DockerSandboxOptions
    ): Promise<ContainerLogs> {
        const executionId = Math.random().toString(36).substring(7);
        const tempExecDir = await fs.mkdtemp(path.join(os.tmpdir(), `sandbox-run-${executionId}-`));

        try {
            // A. Dump VFS content to temp execution dir
            for (const file of options.vfs.getAllFiles()) {
                const targetPath = path.join(tempExecDir, file.path);
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.writeFile(targetPath, file.content);
            }

            // B. Determine Command
            const command: string[] = [];

            if (options.cmd) {
                command.push(...options.cmd);
            } else {
                // Handle Entry Point logic
                let scriptPath = options.entryPoint;

                // INTELLIGENT PATH SWAPPING
                // If pointing to a .ts file, point to the compiled .js file in /out
                // (Matches Compiler.ts logic: rootDir='.' -> outDir='./out')
                if (scriptPath.endsWith('.ts')) {
                    scriptPath = path.join('out', scriptPath.replace(/\.ts$/, '.js'));
                }

                // Ensure forward slashes for Linux container
                scriptPath = scriptPath.replace(/\\/g, '/');

                command.push('node', `/sandbox/src/${scriptPath}`);
            }

            // C. Prepare Mounts
            const binds = [
                // 1. The Code: Read-Write (so the process can write temp files if needed)
                `${tempExecDir}:/sandbox/src:rw`,

                // 2. The Modules: Read-Only (Overlay mount)
                // This puts the host's cached node_modules into the container's working tree
                `${path.join(options.pkgRoot, 'node_modules')}:/sandbox/src/node_modules:ro`
            ];

            return await this.runContainer(command, binds, options);

        } finally {
            // Cleanup the temporary code directory
            await fs.rm(tempExecDir, { recursive: true, force: true });
        }
    }

    private async runContainer(cmd: string[], binds: string[], options?: DockerSandboxOptions): Promise<ContainerLogs> {
        const container = await this.docker.createContainer({
            Image: DockerSandbox.IMAGE,
            Cmd: cmd,
            WorkingDir: '/sandbox/src',
            HostConfig: {
                Binds: binds,
                AutoRemove: true,
                Memory: options?.memoryLimit || 128 * 1024 * 1024,
                CpuQuota: options?.cpuLimit || 50000
            },
            Tty: false,
            Env: Object.entries(options?.env || {}).map(([key, value]) => `${key}=${value}`)
        });

        await container.start();
        return this.captureLogs(container, options?.timeoutMs || 10000);
    }

    private async captureLogs(container: Dockerode.Container, timeout: number): Promise<ContainerLogs> {
        const stderr: string[] = [];
        const stdout: string[] = [];
        const MAX_LOG_SIZE = 5000;

        const stream = await container.logs({ follow: true, stdout: true, stderr: true });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(async () => {
                try {
                    await container.stop();
                } catch (e) { /* Ignore if already stopped */ }
                reject(new Error(`Execution timed out after ${timeout}ms`));
            }, timeout);

            container.modem.demuxStream(stream,
                { write: (b: Buffer) => stdout.length < MAX_LOG_SIZE && stdout.push(b.toString()) },
                { write: (b: Buffer) => stderr.length < MAX_LOG_SIZE && stderr.push(b.toString()) }
            );

            stream.on('end', () => {
                clearTimeout(timer);
                resolve({
                    stdout: stdout.join('').split('\n').filter(Boolean),
                    stderr: stderr.join('').split('\n').filter(Boolean)
                });
            });

            stream.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }
}