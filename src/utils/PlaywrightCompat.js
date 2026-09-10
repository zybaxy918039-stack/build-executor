/**
 * Load Playwright on Termux.
 *
 * Playwright does not list Android as a supported host platform and throws
 * while initializing its browser registry. Termux Chromium is compatible
 * with the Linux launcher interface, so only the registry initialization is
 * presented as Linux; the original platform is restored immediately after.
 */
const loadPlaywright = () => {
    if (process.platform !== "android") return require("playwright");

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
    try {
        return require("playwright");
    } finally {
        Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
    }
};

module.exports = loadPlaywright();
