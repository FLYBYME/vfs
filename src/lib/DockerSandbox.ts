import Dockerode from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ContainerLogs } from "./types";
import { VirtualFileSystem } from './VirtualFileSystem';
import { VirtualFile } from './VirtualFile';

export interface DockerSandboxOptions {
    vfs: VirtualFileSystem;
    entryPoint: VirtualFile;
    timeoutMs?: number;
    env?: Record<string, string>;
    memoryLimit?: number;
    cpuLimit?: number;
    cmd?: string[];
}

export class DockerSandbox {
    private docker = new Dockerode();
    private static IMAGE = 'agent-sandbox-runner:latest';

    public async execute(
        options: DockerSandboxOptions
    ): Promise<ContainerLogs> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-exec-'));

        for (const file of options.vfs.getAllFiles()) {
            await fs.mkdir(path.join(tempDir, path.dirname(file.path)), { recursive: true });
            await fs.writeFile(path.join(tempDir, file.path), file.content);
        }

        try {
            return await this.runContainer(tempDir, options.cmd || ['node', `/sandbox/src/${options.entryPoint.path}`], options);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    private async runContainer(hostPath: string, cmd: string[], options?: DockerSandboxOptions): Promise<ContainerLogs> {
        const container = await this.docker.createContainer({
            Image: DockerSandbox.IMAGE,
            Cmd: cmd,
            HostConfig: {
                Binds: [`${hostPath}:/sandbox/src:ro`],
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
        const MAX_LOG_SIZE = 1000; // Prevent memory exhaustion

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