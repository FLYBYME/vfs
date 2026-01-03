import Dockerode from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ContainerLogs } from "./types";
import { VirtualFileSystem } from './VirtualFileSystem';
import { VirtualFile } from './VirtualFile';

export class DockerSandbox {
    private docker = new Dockerode();
    private static IMAGE = 'agent-sandbox-runner:latest';

    public async execute(
        vfs: VirtualFileSystem,
        entryPoint: VirtualFile,
        timeoutMs: number = 10000
    ): Promise<ContainerLogs> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-exec-'));

        for (const file of vfs.getAllFiles()) {
            await fs.mkdir(path.join(tempDir, path.dirname(file.path)), { recursive: true });
            await fs.writeFile(path.join(tempDir, file.path), file.content);
        }

        try {
            return await this.runContainer(tempDir, ['node', `/sandbox/src/${entryPoint.path}`], timeoutMs);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    private async runContainer(hostPath: string, cmd: string[], timeout: number): Promise<ContainerLogs> {
        const container = await this.docker.createContainer({
            Image: DockerSandbox.IMAGE,
            Cmd: cmd,
            HostConfig: {
                Binds: [`${hostPath}:/sandbox/src:ro`],
                AutoRemove: true
            },
            Tty: false
        });

        await container.start();
        return this.captureLogs(container, timeout);
    }

    private async captureLogs(container: Dockerode.Container, timeout: number): Promise<ContainerLogs> {
        const stderr: string[] = [];
        const stdout: string[] = [];
        const stream = await container.logs({ follow: true, stdout: true, stderr: true });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                container.stop().catch(() => { });
                reject(new Error("Timeout"));
            }, timeout);

            container.modem.demuxStream(stream, {
                write: (b: Buffer) => stdout.push(b.toString())
            }, {
                write: (b: Buffer) => stderr.push(b.toString())
            });

            stream.on('end', () => {
                clearTimeout(timer);
                resolve({ stdout: stdout.map(l => l.trim()), stderr: stderr.map(l => l.trim()) });
            });
        });
    }
}