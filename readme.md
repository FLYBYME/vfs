# Virtual File System (VFS) & Development Toolkit

A sophisticated, in-memory **Git-like Virtual File System** with integrated **TypeScript compilation**, **Docker sandboxing**, and **Merkle Tree-based** version control. This toolkit allows you to manage, version, compile, and execute code entirely within a virtual environment.

---

## 🚀 Key Features

* **Git-Core Implementation**: Full Merkle Tree content-addressable storage supporting `commits`, `branching`, `three-way merges`, and `checkout`.
* **In-Memory Compilation**: Compile TypeScript to JavaScript and generate `.d.ts` files directly from the VFS using the `TypeScriptCompiler`.
* **Secure Execution**: Execute code from the VFS in an isolated `DockerSandbox` to safely capture logs and results.
* **Persistence**: Save and load the entire state (history + working directory) via JSON snapshots.
* **Project Scaffolding**: Built-in templates for `package.json`, `tsconfig.json`, and standard Node.js project structures.

---

## 📦 Core Architecture

### 1. Virtual File System (`VirtualFileSystem`)

The core engine that manages the lifecycle of files. It tracks "Working Directory" changes and moves them into permanent storage via commits.

* **Branching**: Create, merge, and delete branches.
* **Status**: Get diffs between the working directory and the current `HEAD`.
* **Object Store**: Pluggable storage (defaults to `InMemoryObjectStore`) for Git blobs, trees, and commits.

### 2. TypeScript Compiler (`TypeScriptCompiler`)

A wrapper around the TypeScript API designed to interface with the VFS.

* Generates type definitions (`.d.ts`) for tools.
* Compiles source files into a `CompilationResult` containing JS code and diagnostics.

### 3. Docker Sandbox (`DockerSandbox`)

Provides a layer of security for running code.

* Takes a `VirtualFileSystem` instance as a source.
* Runs the code in a containerized environment.
* Returns captured `stdout` and `stderr`.

---

## 🛠 Usage Example

```typescript
import { VirtualFileSystem, TypeScriptCompiler, ProjectScaffolder } from './vfs';

async function main() {
  // 1. Initialize VFS and Scaffolder
  const vfs = new VirtualFileSystem();
  const scaffolder = new ProjectScaffolder(vfs);
  
  // 2. Scaffold a new Node.js project
  scaffolder.scaffoldNodeProject('my-virtual-app');
  
  // 3. Write some TypeScript code
  const code = `export const hello = (name: string): string => "Hello, " + name;`;
  vfs.write('src/index.ts', code);
  
  // 4. Version the changes
  await vfs.commit('Initial scaffolding and source', 'Author Name');
  
  // 5. Compile the code
  const compiler = new TypeScriptCompiler(vfs);
  const result = compiler.compileFiles();
  
  if (result.success) {
    console.log('Successfully compiled to virtual disk!');
  }
}

```

---

## 📑 API Overview

### File Management

* `read(path)`: Retrieves a `VirtualFile` with content and metadata.
* `write(path, content)`: Adds/updates a file in the working directory.
* `readdir(path, options)`: Lists files/folders (supports recursive mode).

### Version Control

* `commit(message, author?)`: Snapshots the current working directory.
* `checkout(hashOrRef)`: Switches the working directory to a specific commit or branch.
* `merge(branchName)`: Performs a three-way merge into the current branch.
* `log()`: Returns the commit history.

### Tooling

* **`ToolRegistry`**: High-level manager to organize TypeScript "tools" and generate prompts for LLM integrations.
* **`GitIgnore`**: Logic to filter files based on standard `.gitignore` patterns.

---

## 💾 Persistence

The VFS can be serialized to disk as a single JSON file, preserving all history, branches, and uncommitted changes:

```typescript
// Save state
await vfs.saveToDisk('./vfs-snapshot.json');

// Restore state later
await vfs.loadFromDisk('./vfs-snapshot.json');

```