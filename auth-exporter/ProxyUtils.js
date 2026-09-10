const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
const firstEnv = keys => {
    const key = keys.find(item => process.env[item] && String(process.env[item]).trim());
    return key ? { key, value: String(process.env[key]).trim() } : null;
};
const parseProxyFromEnv = () => {
    const value = firstEnv(PROXY_KEYS);
    if (!value) return null;
    try {
        const url = new URL(value.value);
        return {
            password: url.password ? decodeURIComponent(url.password) : undefined,
            server: `${url.protocol}//${url.host}`,
            username: url.username ? decodeURIComponent(url.username) : undefined,
        };
    } catch {
        return { server: value.value };
    }
};
const getProxySummaryFromEnv = () => {
    const value = firstEnv(PROXY_KEYS);
    if (!value) return { enabled: false };
    try {
        const url = new URL(value.value);
        return { enabled: true, envKey: value.key, server: `${url.protocol}//${url.host}` };
    } catch {
        return { enabled: true, envKey: value.key, server: "configured" };
    }
};
module.exports = { getProxySummaryFromEnv, parseProxyFromEnv };
