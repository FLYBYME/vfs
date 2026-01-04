import { DockerSandbox } from "../lib/DockerSandbox";
import { VirtualFileSystem } from "../lib/VirtualFileSystem";
import Dockerode from "dockerode";
import fs from "fs/promises";
import path from "path";
import { EventEmitter } from "events";

jest.mock("dockerode");
jest.mock("fs/promises");

describe("DockerSandbox", () => {
    let sandbox: DockerSandbox;
    let vfs: VirtualFileSystem;
    let mockContainer: any;
    let mockStream: any;
    const pkgRoot = "/test/pkgRoot";

    beforeEach(() => {
        jest.clearAllMocks();
        sandbox = new DockerSandbox();
        vfs = new VirtualFileSystem("/project");

        mockStream = new EventEmitter();
        mockContainer = {
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            logs: jest.fn().mockResolvedValue(mockStream),
            modem: {
                demuxStream: jest.fn((stream, stdout, stderr) => {
                    stdout.write(Buffer.from("output\n"));
                    process.nextTick(() => stream.emit("end"));
                })
            }
        };

        (Dockerode.prototype.createContainer as jest.Mock).mockResolvedValue(mockContainer);
        (fs.mkdtemp as jest.Mock).mockResolvedValue("/tmp/sandbox-run");
        (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
        (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
        (fs.rm as jest.Mock).mockResolvedValue(undefined);
    });

    it("should install dependencies", async () => {
        const packageJson = '{"name": "test"}';
        await sandbox.installDependencies(pkgRoot, packageJson);

        expect(fs.mkdir).toHaveBeenCalledWith(pkgRoot, { recursive: true });
        expect(fs.writeFile).toHaveBeenCalledWith(path.join(pkgRoot, "package.json"), packageJson);
        expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
            Cmd: ["npm", "install"]
        }));
    });

    it("should execute code and dump VFS files using relative paths", async () => {
        vfs.write("src/index.ts", "console.log('hi')");

        const result = await sandbox.execute({
            vfs,
            entryPoint: "src/index.ts",
            pkgRoot
        });

        // Verify file write uses relative path from VFS root in the temp dir
        expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/[\\/]src[\\/]index\.ts$/), "console.log('hi')");

        // entryPoint index.ts -> out/index.js
        expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
            Cmd: ["node", "/sandbox/out/src/index.js"]
        }));
        expect(result.stdout).toContain("output");
    });

    it("should swap .ts to .js correctly for absolute-style virtual entry point", async () => {
        await sandbox.execute({
            vfs,
            entryPoint: "/src/main.ts",
            pkgRoot
        });

        expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(expect.objectContaining({
            Cmd: ["node", "/sandbox/out/src/main.js"]
        }));
    });
});
