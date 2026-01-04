// Suppress the localStorage warning from Jest
// This warning is harmless and occurs because Node.js doesn't have localStorage by default

// Capture and filter process warnings
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
    if (
        name === 'warning' &&
        data &&
        data.message &&
        data.message.includes('--localstorage-file')
    ) {
        return false; // Suppress this specific warning
    }
    return originalEmit.apply(process, [name, data, ...args]);
};

