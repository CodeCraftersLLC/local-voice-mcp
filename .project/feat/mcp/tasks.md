<chatName="MCP_Feature_Task_List"/>

````markdown
# Local Voice MCP - MCP Integration Feature Tasks

This document outlines the development tasks required to implement the MCP (Master Control Program) integration feature as specified in the PRD.

## I. Core Server Enhancements

### 1. `ChatterboxService` Modifications (`src/core/chatterbox.service.ts`)

    - [ ] **Task 1.1: Expose Environment Setup Promise**
        - **File:** `src/core/chatterbox.service.ts`
        - **Details:**
            - Add a public method `async ensureReady(): Promise<void>` to the `ChatterboxService` class.
            - This method should return `this.environmentSetupPromise`.
        - **Reasoning:** Allows the server to explicitly wait for Python environment setup completion before starting.

### 2. `server.ts` Refactoring (`src/server.ts`)

    - [ ] **Task 2.1: Refactor `ttsHandler` for Robust Temporary File Deletion**
        - **File:** `src/server.ts`
        - **Details:**
            - Declare `audioPath: string | undefined;` at the beginning of the `ttsHandler` function, outside any `try` block.
            - Wrap the core TTS synthesis and audio streaming logic within a `try...catch...finally` structure.
            - **Inside the `try` block:**
                - After `audioPath` is obtained from `chatterbox.synthesize()`, validate that `audioPath` is located within `TEMP_AUDIO_DIR`. Use `path.resolve()`, `path.normalize()`, and `startsWith()` for robust validation.
                - If validation fails, log a security alert, set `audioPath = undefined;` (to prevent deletion attempts on invalid paths in `finally`), and throw an error (e.g., `new Error('Invalid audio path generated.')`).
                - Manage audio streaming using `fs.createReadStream(audioPath)` and `audioStream.pipe(res)`. Wrap this streaming operation in a `new Promise<void>((resolve, reject) => { ... })` that uses `finished(audioStream, (err) => { ... })` and `audioStream.on('error', ...)` to `resolve` on successful completion or `reject` on stream error. `await` this promise.
            - **Inside the `catch (error)` block:**
                - Log the error.
                - If `!res.headersSent`, send a 500 error response (e.g., `res.status(500).json({ error: 'TTS processing failed' })`).
            - **Inside the `finally` block:**
                - Check if `audioPath` is defined and `fs.existsSync(audioPath)` is true.
                - **Critically re-validate** that `audioPath` is within `TEMP_AUDIO_DIR` before attempting deletion (as a final safety check).
                - If valid, call `fs.unlink(audioPath, (unlinkErr) => { ... })` to delete the temporary file.
                - Log the success or failure of the `fs.unlink` operation. If deletion fails, log the error but do not let it crash the server or affect the client response if already sent.
        - **Reasoning:** Ensures temporary audio files are reliably deleted after successful streaming or in case of any error, and enhances security with path validation.

    - [ ] **Task 2.2: Encapsulate Server Startup in `startApp` Function**
        - **File:** `src/server.ts`
        - **Details:**
            - Create an `export async function startApp(port: number): Promise<void>` function.
            - Move the Express `app` initialization, middleware setup (`app.use(bodyParser.json())`, `authenticate`), route definitions (`app.post('/tts', ...)`), and `TEMP_AUDIO_DIR` setup into this function.
            - At the beginning of `startApp`, call `await chatterbox.ensureReady();`. Handle potential errors from `ensureReady` by logging and re-throwing to prevent server startup.
            - Wrap `app.listen(port, ...)` in a `new Promise<void>((resolve, reject) => { ... })`. The promise should `resolve()` in the `app.listen` callback (when the server is listening) and `reject(err)` if `serverInstance.on('error', (err) => { ... })` occurs.
        - **Reasoning:** Allows programmatic control over server startup, essential for the MCP entry point.

    - [ ] **Task 2.3: Make Direct Server Listening Conditional**
        - **File:** `src/server.ts`
        - **Details:**
            - Remove the existing unconditional `app.listen()` call at the end of the file.
            - Add a conditional block:
              ```typescript
              if (require.main === module) {
                const defaultPort = parseInt(process.env.PORT || '59125', 10);
                startApp(defaultPort).catch(error => {
                  console.error("Failed to start application directly:", error);
                  process.exit(1);
                });
              }
              ```
        - **Reasoning:** Enables `src/server.ts` to be run directly for development (e.g., `ts-node src/server.ts`) while also being importable without side effects.

    - [ ] **Task 2.4: Verify and Add Necessary Imports**
        - **File:** `src/server.ts`
        - **Details:** Ensure all necessary modules like `fs`, `path`, `os`, and `finished` (from `stream`) are imported.
        - **Reasoning:** Code hygiene and functionality.

## II. MCP Packaging & Executable

### 3. MCP Server Entry Point (`src/mcp-server.ts`)

    - [ ] **Task 3.1: Create `src/mcp-server.ts` File**
        - **File:** `src/mcp-server.ts` (New file)
        - **Details:** This file will serve as the command-line executable.

    - [ ] **Task 3.2: Implement Shebang and Imports**
        - **File:** `src/mcp-server.ts`
        - **Details:**
            - Add `#!/usr/bin/env node` as the first line.
            - Import `startApp` from `./server`.

    - [ ] **Task 3.3: Implement Main Execution Logic**
        - **File:** `src/mcp-server.ts`
        - **Details:**
            - Define `const PORT = parseInt(process.env.PORT || '59125', 10);`.
            - Create an `async function main()` that:
                - Logs an attempt to start the server.
                - Calls `await startApp(PORT);`.
                - Includes a `try...catch` block around `startApp(PORT)` to log errors and call `process.exit(1)` on failure.
            - Call `main();`.

    - [ ] **Task 3.4: Implement Graceful Shutdown Handling**
        - **File:** `src/mcp-server.ts`
        - **Details:**
            - Listen for `SIGINT` and `SIGTERM` signals using `process.on(signal, callback)`.
            - In the callback, log that the signal was received and the server is shutting down.
            - Call `process.exit(0);` to terminate the process.
            - (Future enhancement: If `startApp` returned the server instance, `server.close()` could be called here).

### 4. `package.json` Updates

    - [ ] **Task 4.1: Add `bin` Field**
        - **File:** `package.json`
        - **Details:** Add a `bin` field to map a command name (e.g., `local-voice-mcp-server`) to the compiled JavaScript entry point:
          ```json
          "bin": {
            "local-voice-mcp-server": "./dist/mcp-server.js"
          }
          ```
        - **Note:** Assumes `tsconfig.json` `outDir` is `dist`. Adjust if different.

    - [ ] **Task 4.2: Update `scripts` Field**
        - **File:** `package.json`
        - **Details:**
            - Add a build script: `"build": "tsc"`.
            - Add scripts for running the MCP server:
                - `"start:mcp": "npm run build && node dist/mcp-server.js"`
                - `"dev:mcp": "ts-node src/mcp-server.ts"`
            - Ensure the existing `"start": "ts-node src/server.ts"` script is preserved for direct development.

### 5. `.gitignore` Update

    - [ ] **Task 5.1: Add TypeScript Output Directory**
        - **File:** `.gitignore`
        - **Details:** Add `dist/` (or your TypeScript `outDir`) to ignore compiled JavaScript files.
          ```
          # TypeScript output
          dist/
          ```

## III. Documentation

    - [ ] **Task 6.1: Update/Create `README.md` with MCP Usage Instructions**
        - **File:** `README.md` (Create if it doesn't exist)
        - **Details:**
            - Document how to install the package (globally or locally).
            - Explain how to run the server using the new command (e.g., `local-voice-mcp-server` or `npx local-voice-mcp-server`).
            - Describe configuration options (e.g., `PORT` environment variable).
            - Provide an example of how an MCP orchestrator (like `taskqueue`) might configure and launch this server, referencing the user's example:
              ```json
              "taskqueue_service_name": { // Example service name
                "command": "npx", // Or path to local-voice-mcp-server if installed globally/locally
                "args": ["local-voice-mcp-server"], // Or ["-y", "your-npm-package-name"] if using npx -y
                "env": {
                  "PORT": "59126" // Optional: if different from default
                }
              }
              ```

## IV. Constants and Configuration Verification

    - [ ] **Task 7.1: Verify `TEMP_AUDIO_DIR` Usage**
        - **File:** `src/server.ts`
        - **Details:**
            - Ensure `TEMP_AUDIO_DIR` is correctly defined (e.g., `const TEMP_AUDIO_DIR = path.join(os.tmpdir(), 'local-voice-mcp');`).
            - Confirm it's consistently used for generating output paths in `ChatterboxService` (if applicable, though `tts_runner.py` seems to handle its own temp path which `ChatterboxService` then returns) and critically for path validation in `ttsHandler` before streaming and deletion.
            - Ensure the directory `TEMP_AUDIO_DIR` is created if it doesn't exist at server startup (already in `src/server.ts`).
````
