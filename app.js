import { createIcons, Monitor, Moon, Sun, TriangleAlert, X } from "lucide";

const CLIENT_VERSION = "0.0.1";
const WEBSOCKET_URL = "wss://gcli.ggchan.dev/api/build/ws";
const GOOGLE_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const BUILD_API_KEY = String(process.env.API_KEY || process.env.GEMINI_API_KEY || "").trim();
const MAX_ACTIVITY_ROWS = 30;
const MAX_ERROR_MESSAGE_LENGTH = 1000;
const MAX_ERROR_BODY_DISPLAY_LENGTH = 64 * 1024;
const PREFILL_UNSUPPORTED_ERROR = "Requests ending with a model turn are not supported";
const MAX_WEBSOCKET_BUFFERED_AMOUNT = 1024 * 1024;
const WEBSOCKET_BACKPRESSURE_POLL_MS = 10;
const CLOSE_EXECUTOR_REPLACED = 4001;
const CLOSE_API_KEY_CHANGED = 4002;
const SILENT_AUDIO_SAMPLE_RATE = 8000;
const SILENT_AUDIO_DURATION_SECONDS = 1;
const PICTURE_IN_PICTURE_WIDTH = 320;
const PICTURE_IN_PICTURE_HEIGHT = 180;
const PICTURE_IN_PICTURE_FRAME_RATE = 1;
const PICTURE_IN_PICTURE_FRAME_INTERVAL_MS = 1000;
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

let silentAudioSource = "";

const storageKeys = {
  apiKey: "gogcli_build_executor_api_key",
  remember: "gogcli_build_executor_remember_key",
  theme: "gogcli_build_executor_theme",
};

const state = {
  socket: null,
  shouldReconnect: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
  registered: false,
  versionRejected: false,
  registrationRejected: false,
  connectedAt: 0,
  durationTimer: null,
  active: new Map(),
  activities: [],
  activitySequence: 0,
  successCount: 0,
  failureCount: 0,
  keepAliveAudio: null,
  keepAliveEnabled: false,
  keepAliveMode: "none",
  keepAliveTransitioning: false,
  pictureInPictureCanvas: null,
  pictureInPictureStream: null,
  pictureInPictureFrameTimer: null,
  pictureInPictureActive: false,
};

const elements = {
  form: document.querySelector("#connection-form"),
  apiKey: document.querySelector("#user-api-key"),
  rememberKey: document.querySelector("#remember-key"),
  toggleKey: document.querySelector("#toggle-key"),
  connect: document.querySelector("#connect-button"),
  disconnect: document.querySelector("#disconnect-button"),
  keepAliveMode: document.querySelector("#keepalive-mode"),
  keepAliveVideo: document.querySelector("#keepalive-video"),
  status: document.querySelector("#connection-status"),
  statusText: document.querySelector("#connection-status-text"),
  message: document.querySelector("#connection-message"),
  activeCount: document.querySelector("#active-count"),
  successCount: document.querySelector("#success-count"),
  failureCount: document.querySelector("#failure-count"),
  connectionDuration: document.querySelector("#connection-duration"),
  activityBody: document.querySelector("#activity-body"),
  clearActivity: document.querySelector("#clear-activity"),
  prefillToast: document.querySelector("#prefill-unsupported-toast"),
  dismissPrefillToast: document.querySelector("#dismiss-prefill-toast"),
  themeOptions: document.querySelectorAll("[data-theme-option]"),
};

function setStatus(status, text) {
  elements.status.dataset.state = status;
  elements.status.title = text;
  elements.statusText.textContent = text;
}

function setMessage(text = "", stateName = "") {
  elements.message.textContent = text;
  if (stateName) {
    elements.message.dataset.state = stateName;
  } else {
    delete elements.message.dataset.state;
  }
}

function applyThemeMode(requestedMode, persist = true) {
  const mode = requestedMode === "light" || requestedMode === "dark" ? requestedMode : "system";
  const dark = mode === "dark" || (mode === "system" && themeMediaQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themeMode = mode;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = dark ? "#101012" : "#f7f7f8";
  for (const option of elements.themeOptions) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === mode));
  }
  if (!persist) return;
  try {
    if (mode === "system") {
      localStorage.removeItem(storageKeys.theme);
    } else {
      localStorage.setItem(storageKeys.theme, mode);
    }
  } catch {
    // Theme selection still applies when storage is unavailable.
  }
}

function restoreThemeMode() {
  applyThemeMode(document.documentElement.dataset.themeMode || "system", false);
}

function handleSystemThemeChange() {
  if (document.documentElement.dataset.themeMode === "system") {
    applyThemeMode("system", false);
  }
}

function updateControls() {
  const connecting = state.socket && state.socket.readyState === WebSocket.CONNECTING;
  const connected = state.socket && state.socket.readyState === WebSocket.OPEN;
  const retrying = state.shouldReconnect && !connecting && !connected;
  elements.connect.disabled = Boolean(connecting || connected || !BUILD_API_KEY || state.versionRejected);
  elements.disconnect.disabled = !connecting && !connected && !retrying;
  elements.disconnect.textContent = retrying ? "取消重试" : "断开";
  elements.apiKey.disabled = Boolean(connecting || connected);
  elements.rememberKey.disabled = Boolean(connecting || connected);
  elements.activeCount.textContent = String(state.active.size);
  elements.successCount.textContent = String(state.successCount);
  elements.failureCount.textContent = String(state.failureCount);
}

function createSilentAudioSource() {
  if (silentAudioSource) return silentAudioSource;

  const sampleCount = SILENT_AUDIO_SAMPLE_RATE * SILENT_AUDIO_DURATION_SECONDS;
  const dataLength = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SILENT_AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, SILENT_AUDIO_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  silentAudioSource = `data:audio/wav;base64,${btoa(binary)}`;
  return silentAudioSource;
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    if (typeof MediaMetadata === "function") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "移动端保活",
        artist: "Build Executor",
        album: "Browser Executor",
      });
    }
    navigator.mediaSession.setActionHandler("play", async () => {
      if (state.keepAliveAudio?.paused) {
        try {
          await state.keepAliveAudio.play();
        } catch {
          // The page-level control remains enabled so visibility recovery can retry.
        }
      }
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      void changeKeepAliveMode("none");
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      void changeKeepAliveMode("none");
    });
    navigator.mediaSession.setActionHandler("previoustrack", null);
    navigator.mediaSession.setActionHandler("nexttrack", null);
    navigator.mediaSession.setActionHandler("seekbackward", null);
    navigator.mediaSession.setActionHandler("seekforward", null);
  } catch {
    // Media Session is optional; looping audio still provides the keep-alive behavior.
  }
}

function clearMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.setActionHandler("play", null);
    navigator.mediaSession.setActionHandler("pause", null);
    navigator.mediaSession.setActionHandler("stop", null);
  } catch {
    // Ignore partial Media Session support.
  }
}

async function startMobileKeepAlive() {
  if (state.keepAliveEnabled) return true;

  const audio = document.createElement("audio");
  audio.src = createSilentAudioSource();
  audio.loop = true;
  audio.preload = "auto";
  audio.playsInline = true;
  audio.setAttribute("playsinline", "true");
  audio.volume = 0.02;
  audio.controls = false;
  audio.className = "keepalive-audio";
  document.body.appendChild(audio);

  try {
    await audio.play();
  } catch {
    audio.remove();
    setMessage("浏览器阻止了媒体播放，请允许播放后重试", "error");
    return false;
  }

  state.keepAliveAudio = audio;
  state.keepAliveEnabled = true;
  setupMediaSession();
  return true;
}

function stopMobileKeepAlive() {
  if (state.keepAliveAudio) {
    try {
      state.keepAliveAudio.pause();
    } catch {
      // Ignore cleanup errors from partially initialized media elements.
    }
    state.keepAliveAudio.removeAttribute("src");
    state.keepAliveAudio.remove();
    state.keepAliveAudio = null;
  }
  clearMediaSession();
  state.keepAliveEnabled = false;
}

function supportsPictureInPictureKeepAlive() {
  const video = elements.keepAliveVideo;
  const supportsStandardAPI = Boolean(
    document.pictureInPictureEnabled
    && typeof video?.requestPictureInPicture === "function"
  );
  const supportsWebKitAPI = Boolean(
    typeof video?.webkitSupportsPresentationMode === "function"
    && typeof video?.webkitSetPresentationMode === "function"
  );
  return Boolean(
    video
    && typeof HTMLCanvasElement.prototype.captureStream === "function"
    && (supportsStandardAPI || supportsWebKitAPI)
  );
}

function preparePictureInPictureVideo() {
  const video = elements.keepAliveVideo;
  if (state.pictureInPictureStream && video.srcObject === state.pictureInPictureStream) {
    return true;
  }

  const canvas = document.createElement("canvas");
  canvas.width = PICTURE_IN_PICTURE_WIDTH;
  canvas.height = PICTURE_IN_PICTURE_HEIGHT;
  if (!drawPictureInPictureFrame(canvas, 0)) return false;

  const stream = canvas.captureStream(PICTURE_IN_PICTURE_FRAME_RATE);
  state.pictureInPictureCanvas = canvas;
  state.pictureInPictureStream = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.srcObject = stream;
  return true;
}

function isPictureInPictureActive() {
  const video = elements.keepAliveVideo;
  return Boolean(
    document.pictureInPictureElement === video
    || video.webkitPresentationMode === "picture-in-picture"
  );
}

function supportsWebKitPictureInPicture(video) {
  if (
    typeof video.webkitSupportsPresentationMode !== "function"
    || typeof video.webkitSetPresentationMode !== "function"
  ) {
    return false;
  }
  try {
    return video.webkitSupportsPresentationMode("picture-in-picture");
  } catch {
    return false;
  }
}

function drawPictureInPictureFrame(canvas, frameNumber) {
  const context = canvas.getContext("2d");
  if (!context) return false;
  if (frameNumber === 0) {
    context.fillStyle = "#101012";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.fillStyle = frameNumber % 2 === 0 ? "#101012" : "#111113";
  context.fillRect(canvas.width - 2, canvas.height - 2, 2, 2);
  return true;
}

function cleanupPictureInPictureKeepAlive() {
  if (state.pictureInPictureFrameTimer !== null) {
    clearInterval(state.pictureInPictureFrameTimer);
    state.pictureInPictureFrameTimer = null;
  }
  state.pictureInPictureActive = false;
  try {
    elements.keepAliveVideo.pause();
  } catch {
    // Ignore cleanup errors from partially initialized media elements.
  }
}

function disposePictureInPictureKeepAlive() {
  cleanupPictureInPictureKeepAlive();
  if (state.pictureInPictureStream) {
    for (const track of state.pictureInPictureStream.getTracks()) track.stop();
    state.pictureInPictureStream = null;
  }
  state.pictureInPictureCanvas = null;
  elements.keepAliveVideo.srcObject = null;
}

async function startPictureInPictureKeepAlive() {
  if (state.pictureInPictureActive && isPictureInPictureActive()) {
    return true;
  }
  if (!supportsPictureInPictureKeepAlive()) {
    setMessage("当前浏览器不支持画中画保活", "error");
    return false;
  }

  if (!preparePictureInPictureVideo()) {
    setMessage("无法创建画中画视频", "error");
    return false;
  }

  const video = elements.keepAliveVideo;
  let frameNumber = 0;
  state.pictureInPictureFrameTimer = window.setInterval(() => {
    frameNumber += 1;
    drawPictureInPictureFrame(state.pictureInPictureCanvas, frameNumber);
  }, PICTURE_IN_PICTURE_FRAME_INTERVAL_MS);

  try {
    await video.play();
    if (supportsWebKitPictureInPicture(video)) {
      video.webkitSetPresentationMode("picture-in-picture");
      if (video.webkitPresentationMode !== "picture-in-picture") {
        throw new DOMException("Safari did not enter Picture-in-Picture mode", "NotAllowedError");
      }
    } else if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
      await video.requestPictureInPicture();
    } else {
      throw new DOMException("The video element does not support Picture-in-Picture mode", "NotSupportedError");
    }
  } catch (error) {
    console.error("[build] picture-in-picture activation failed", {
      name: error?.name,
      message: error?.message,
      readyState: video.readyState,
      userActivationActive: navigator.userActivation?.isActive,
      webkitPresentationMode: video.webkitPresentationMode,
    });
    cleanupPictureInPictureKeepAlive();
    const isSafari = typeof video.webkitSetPresentationMode === "function";
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      setMessage(
        isSafari
          ? "Safari 阻止了画中画，请在 Safari 标签页中直接打开页面后重试"
          : "浏览器阻止了画中画，请直接打开页面后重试",
        "error",
      );
    } else if (error?.name === "NotSupportedError") {
      setMessage(
        isSafari
          ? "当前 Safari 环境不支持画中画，请勿从主屏幕网页应用中打开"
          : "当前浏览器环境不支持画中画",
        "error",
      );
    } else {
      setMessage("画中画视频尚未就绪，请重试", "error");
    }
    return false;
  }

  state.pictureInPictureActive = true;
  return true;
}

function stopPictureInPictureKeepAlive() {
  const video = elements.keepAliveVideo;
  if (
    video.webkitPresentationMode === "picture-in-picture"
    && typeof video.webkitSetPresentationMode === "function"
  ) {
    try {
      video.webkitSetPresentationMode("inline");
    } catch {
      // Cleanup below still stops local playback state.
    }
  } else if (document.pictureInPictureElement === video) {
    document.exitPictureInPicture().catch(() => {});
  }
  cleanupPictureInPictureKeepAlive();
}

function normalizeKeepAliveMode(mode) {
  return mode === "audio" || mode === "pip" ? mode : "none";
}

async function restoreKeepAliveMode(mode) {
  let restoredMode = mode;
  if (mode === "audio") {
    if (!state.keepAliveEnabled || !state.keepAliveAudio) {
      restoredMode = "none";
    } else if (state.keepAliveAudio.paused) {
      try {
        await state.keepAliveAudio.play();
      } catch {
        stopMobileKeepAlive();
        restoredMode = "none";
      }
    }
  } else if (
    mode === "pip"
    && (!state.pictureInPictureActive || !isPictureInPictureActive())
  ) {
    cleanupPictureInPictureKeepAlive();
    restoredMode = "none";
  }
  state.keepAliveMode = restoredMode;
  elements.keepAliveMode.value = restoredMode;
}

async function changeKeepAliveMode(requestedMode) {
  const nextMode = normalizeKeepAliveMode(requestedMode);
  const previousMode = state.keepAliveMode;
  if (state.keepAliveTransitioning) {
    elements.keepAliveMode.value = previousMode;
    return false;
  }
  if (nextMode === previousMode) {
    elements.keepAliveMode.value = previousMode;
    return true;
  }

  state.keepAliveTransitioning = true;
  elements.keepAliveMode.disabled = true;
  try {
    let started = true;
    if (nextMode === "audio") {
      started = await startMobileKeepAlive();
    } else if (nextMode === "pip") {
      started = await startPictureInPictureKeepAlive();
    }
    if (!started) {
      await restoreKeepAliveMode(previousMode);
      return false;
    }

    if (previousMode === "audio" && nextMode !== "audio") {
      stopMobileKeepAlive();
    } else if (previousMode === "pip" && nextMode !== "pip") {
      stopPictureInPictureKeepAlive();
    }
    state.keepAliveMode = nextMode;
    elements.keepAliveMode.value = nextMode;
    return true;
  } finally {
    state.keepAliveTransitioning = false;
    elements.keepAliveMode.disabled = false;
  }
}

function handlePictureInPictureExit() {
  cleanupPictureInPictureKeepAlive();
  if (!state.keepAliveTransitioning && state.keepAliveMode === "pip") {
    state.keepAliveMode = "none";
    elements.keepAliveMode.value = "none";
  }
}

function handleWebKitPresentationModeChange() {
  if (elements.keepAliveVideo.webkitPresentationMode !== "picture-in-picture") {
    handlePictureInPictureExit();
  }
}

function persistUserKey(apiKey) {
  sessionStorage.setItem(storageKeys.apiKey, apiKey);
  if (elements.rememberKey.checked) {
    localStorage.setItem(storageKeys.apiKey, apiKey);
    localStorage.setItem(storageKeys.remember, "true");
  } else {
    localStorage.removeItem(storageKeys.apiKey);
    localStorage.removeItem(storageKeys.remember);
  }
}

function restoreUserKey() {
  const remembered = localStorage.getItem(storageKeys.remember) === "true";
  const apiKey = remembered
    ? localStorage.getItem(storageKeys.apiKey)
    : sessionStorage.getItem(storageKeys.apiKey);
  elements.rememberKey.checked = remembered;
  elements.apiKey.value = apiKey || "";
}

function removeStoredUserKeyIfCurrent(expectedKey) {
  if (sessionStorage.getItem(storageKeys.apiKey) === expectedKey) {
    sessionStorage.removeItem(storageKeys.apiKey);
  }
  if (localStorage.getItem(storageKeys.apiKey) === expectedKey) {
    localStorage.removeItem(storageKeys.apiKey);
    localStorage.removeItem(storageKeys.remember);
  }
  if (elements.apiKey.value.trim() === expectedKey) {
    elements.apiKey.value = "";
  }
}

function websocketSendNow(payload, socket = state.socket) {
  if (!socket || socket !== state.socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function websocketSend(payload, signal) {
  const socket = state.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;

  while (socket.bufferedAmount > MAX_WEBSOCKET_BUFFERED_AMOUNT) {
    if (signal?.aborted || socket !== state.socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    await new Promise((resolve) => window.setTimeout(resolve, WEBSOCKET_BACKPRESSURE_POLL_MS));
  }
  if (signal?.aborted) return false;
  return websocketSendNow(payload, socket);
}

function connect() {
  const userAPIKey = elements.apiKey.value.trim();
  if (!userAPIKey) {
    setMessage("请输入公益站 API Key", "error");
    elements.apiKey.focus();
    return;
  }
  if (!BUILD_API_KEY) {
    setStatus("error", "Build API 不可用");
    setMessage("当前 AI Studio Build 环境没有提供 API Key", "error");
    return;
  }

  persistUserKey(userAPIKey);
  clearReconnectTimer();
  state.shouldReconnect = true;
  state.versionRejected = false;
  state.registrationRejected = false;
  state.registered = false;
  setStatus("connecting", "正在连接");
  setMessage("");

  let socket;
  try {
    socket = new WebSocket(WEBSOCKET_URL);
  } catch (error) {
    scheduleReconnect(error instanceof Error ? error.message : String(error));
    return;
  }
  state.socket = socket;
  updateControls();

  socket.addEventListener("open", () => {
    state.reconnectAttempt = 0;
    const sent = websocketSendNow({
      type: "register",
      clientVersion: CLIENT_VERSION,
      apiKey: userAPIKey,
    });
    if (!sent) {
      socket.close();
    }
  });

  socket.addEventListener("message", (event) => {
    void handleServerMessage(event.data);
  });

  socket.addEventListener("error", () => {
    if (!state.registered) {
      setStatus("error", "连接错误");
    }
  });

  socket.addEventListener("close", (event) => {
    if (state.socket !== socket) return;
    state.socket = null;
    state.registered = false;
    stopDurationTimer();
    abortAllRequests();
    if (event.code === CLOSE_EXECUTOR_REPLACED) {
      state.shouldReconnect = false;
      clearReconnectTimer();
      setStatus("offline", "连接已被替换");
      setMessage("该 API Key 已在另一个页面建立新连接", "error");
      updateControls();
      return;
    }
    if (event.code === CLOSE_API_KEY_CHANGED) {
      state.shouldReconnect = false;
      state.registrationRejected = true;
      clearReconnectTimer();
      removeStoredUserKeyIfCurrent(userAPIKey);
      setStatus("error", "API Key 已更换");
      setMessage("API Key 已更换，请使用新 Key 重新连接", "error");
      updateControls();
      return;
    }
    updateControls();
    if (state.shouldReconnect && !state.versionRejected) {
      scheduleReconnect("连接已断开");
    } else if (!state.versionRejected && !state.registrationRejected) {
      setStatus("offline", "未连接");
    }
  });
}

function disconnect() {
  state.shouldReconnect = false;
  clearReconnectTimer();
  abortAllRequests();
  if (state.socket) {
    state.socket.close(1000, "user disconnected");
    state.socket = null;
  }
  state.registered = false;
  state.registrationRejected = false;
  stopDurationTimer();
  setStatus("offline", "未连接");
  setMessage("");
  updateControls();
}

function scheduleReconnect(reason) {
  clearReconnectTimer();
  if (!state.shouldReconnect || state.versionRejected) return;
  const delays = [1000, 2000, 5000, 10000, 15000, 30000];
  const delay = delays[Math.min(state.reconnectAttempt, delays.length - 1)];
  state.reconnectAttempt += 1;
  setStatus("connecting", `${Math.ceil(delay / 1000)} 秒后重连`);
  setMessage(reason || "连接已断开", "error");
  state.reconnectTimer = window.setTimeout(connect, delay);
  updateControls();
}

function clearReconnectTimer() {
  if (state.reconnectTimer !== null) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

async function handleServerMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (message.type === "registered") {
    if (message.clientVersion !== CLIENT_VERSION) {
      rejectClientVersion();
      return;
    }
    state.registered = true;
    state.connectedAt = Date.now();
    startDurationTimer();
    setStatus("online", "已连接");
    setMessage("");
    updateControls();
    return;
  }

  if (message.type === "error") {
    const text = String(message.message || "连接失败");
    if (message.code === "client_version_outdated") {
      rejectClientVersion(text);
      return;
    }
    setStatus("error", "连接失败");
    setMessage(text, "error");
    if (!state.registered) {
      state.registrationRejected = true;
      state.shouldReconnect = false;
    }
    return;
  }

  if (message.type === "cancel") {
    const active = state.active.get(String(message.requestId || ""));
    if (active) active.controller.abort();
    return;
  }

  if (message.type === "request") {
    await executeRequest(message);
  }
}

function rejectClientVersion(message = "版本已更新，请刷新页面重试") {
  state.versionRejected = true;
  state.registrationRejected = true;
  state.shouldReconnect = false;
  clearReconnectTimer();
  setStatus("error", "版本已失效");
  setMessage(message, "error");
  if (state.socket) state.socket.close(1008, "client version outdated");
}

async function executeRequest(message) {
  const requestID = String(message.requestId || "").trim();
  const model = String(message.model || "").trim();
  const stream = message.stream === true;
  const requestBody = typeof message.requestBody === "string" ? message.requestBody : "";
  if (!state.registered || !requestID || !isValidModelName(model) || !isGeminiRequestBody(requestBody)) {
    await sendExecutionError(requestID, stream, 400, "invalid_build_request", "后端发送了无效的 Build 请求");
    return;
  }
  if (state.active.has(requestID)) return;

  const controller = new AbortController();
  const startedAt = performance.now();
  state.active.set(requestID, { controller, model, stream, startedAt });
  updateControls();

  let result = "success";
  let resultMessage = "成功";
  let errorDetails = null;
  try {
    if (stream) {
      await executeStream(requestID, model, requestBody, controller.signal);
    } else {
      await executeNonStream(requestID, model, requestBody, controller.signal);
    }
    state.successCount += 1;
  } catch (error) {
    result = "error";
    const details = normalizeExecutionError(error);
    if (isPrefillUnsupportedError(model, details)) {
      showPrefillUnsupportedToast();
    }
    resultMessage = details.message;
    errorDetails = {
      status: details.status,
      code: details.code,
      message: details.message,
      body: truncateErrorBodyForDisplay(details.body),
    };
    state.failureCount += 1;
    if (!controller.signal.aborted) {
      await sendExecutionError(requestID, stream, details.status, details.code, details.message, details.body);
    }
  } finally {
    state.active.delete(requestID);
    addActivity({
      at: new Date(),
      requestID,
      model,
      stream,
      result,
      message: resultMessage,
      error: errorDetails,
      durationMS: Math.round(performance.now() - startedAt),
    });
    updateControls();
  }
}

async function executeNonStream(requestID, model, requestBody, signal) {
  const response = await callGoogle(model, false, requestBody, signal);
  const responseBody = await response.text();
  const payload = parseJSONBody(responseBody);
  if (!response.ok) {
    throw googleResponseError(response.status, payload, responseBody);
  }
  if (!payload || typeof payload !== "object" || !responseBody.trim()) {
    throw executionError(502, "invalid_google_response", "Google Build API 返回了无效响应");
  }
  if (!(await websocketSend({
    type: "response",
    requestId: requestID,
    status: response.status,
    responseBody,
  }, signal))) {
    throw executionError(503, "backend_disconnected", "后端连接已断开");
  }
}

async function executeStream(requestID, model, requestBody, signal) {
  const response = await callGoogle(model, true, requestBody, signal);
  if (!response.ok) {
    const errorBody = await response.text();
    throw googleResponseError(response.status, parseJSONBody(errorBody), errorBody);
  }
  if (!response.body) {
    throw executionError(502, "missing_stream_body", "Google Build API 未返回流式响应体");
  }

  await consumeSSE(response.body, signal, async (payload, rawPayload) => {
    if (payload && typeof payload === "object" && payload.error) {
      throw googleResponseError(Number(payload.error.code) || 502, payload, rawPayload);
    }
    if (!(await websocketSend({ type: "stream-chunk", requestId: requestID, chunkBody: rawPayload }, signal))) {
      throw executionError(503, "backend_disconnected", "后端连接已断开");
    }
  });

  if (!(await websocketSend({ type: "stream-end", requestId: requestID, status: response.status }, signal))) {
    throw executionError(503, "backend_disconnected", "后端连接已断开");
  }
}

async function callGoogle(model, stream, requestBody, signal) {
  const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = `${GOOGLE_API_ROOT}/${encodeURIComponent(model)}:${action}`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": BUILD_API_KEY,
    },
    body: requestBody,
    signal,
  });
}

async function consumeSSE(body, signal, onData) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeEvent = async (eventText) => {
    const dataLines = [];
    for (const line of eventText.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw executionError(502, "invalid_sse_payload", "Google Build API 返回了无效 SSE 数据");
    }
    await onData(payload, data);
  };

  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator;
      while ((separator = findSSESeparator(buffer)) !== null) {
        await consumeEvent(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator.length);
      }
      if (done) break;
    }
    if (buffer.trim()) await consumeEvent(buffer);
  } finally {
    reader.releaseLock();
  }
}

function findSSESeparator(value) {
  const crlf = value.indexOf("\r\n\r\n");
  const lf = value.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseJSONBody(text) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function googleResponseError(status, payload, rawBody = "") {
  const errorBody = payload && typeof payload === "object" ? payload.error : null;
  const fallback = rawBody.trim() || `Google Build API 请求失败 (${status})`;
  const message = String(errorBody?.message || fallback).slice(0, MAX_ERROR_MESSAGE_LENGTH);
  const code = String(errorBody?.status || `google_http_${status}`);
  return executionError(status || 502, code, message, rawBody);
}

function executionError(status, code, message, body = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.body = body;
  return error;
}

function normalizeExecutionError(error) {
  if (error?.name === "AbortError") {
    return { status: 499, code: "request_cancelled", message: "请求已取消", body: null };
  }
  return {
    status: Number(error?.status) || 502,
    code: String(error?.code || "build_execution_failed"),
    message: String(error?.message || "Build 请求执行失败").slice(0, MAX_ERROR_MESSAGE_LENGTH),
    body: typeof error?.body === "string" ? error.body : "",
  };
}

function truncateErrorBodyForDisplay(body) {
  const text = typeof body === "string" ? body : "";
  if (text.length <= MAX_ERROR_BODY_DISPLAY_LENGTH) return text;
  return `${text.slice(0, MAX_ERROR_BODY_DISPLAY_LENGTH)}\n\n[原始响应过长，已截断]`;
}

function formatErrorBody(body) {
  const payload = parseJSONBody(body);
  return payload === null ? body : JSON.stringify(payload, null, 2);
}

function isPrefillUnsupportedError(model, error) {
  if (model !== "gemini-3.7-flash" || error.status !== 400) return false;
  return `${error.message}\n${error.body}`.includes(PREFILL_UNSUPPORTED_ERROR);
}

function showPrefillUnsupportedToast() {
  elements.prefillToast.hidden = false;
}

async function sendExecutionError(requestID, stream, status, code, message, body = "") {
  if (!requestID) return;
  await websocketSend({
    type: stream ? "stream-error" : "error",
    requestId: requestID,
    status,
    error: { code, message, body },
  });
}

function isValidModelName(model) {
  return /^[A-Za-z0-9._-]{1,160}$/.test(model);
}

function isGeminiRequestBody(requestBody) {
  const request = parseJSONBody(requestBody);
  return Boolean(request && typeof request === "object" && Array.isArray(request.contents));
}

function abortAllRequests() {
  for (const active of state.active.values()) active.controller.abort();
  state.active.clear();
  updateControls();
}

function addActivity(activity) {
  state.activities.unshift({
    ...activity,
    id: ++state.activitySequence,
    errorExpanded: false,
  });
  if (state.activities.length > MAX_ACTIVITY_ROWS) state.activities.length = MAX_ACTIVITY_ROWS;
  renderActivity();
}

function renderActivity() {
  elements.clearActivity.disabled = state.activities.length === 0;
  if (state.activities.length === 0) {
    elements.activityBody.innerHTML = '<tr class="empty-row"><td colspan="5">暂无请求</td></tr>';
    return;
  }
  const rows = [];
  for (const activity of state.activities) {
    const row = document.createElement("tr");
    row.className = activity.result === "error" ? "activity-row activity-row-error" : "activity-row";
    const values = [
      activity.at.toLocaleTimeString("zh-CN", { hour12: false }),
      activity.model,
      activity.stream ? "流式" : "非流式",
      activity.result === "success" ? "成功" : "失败",
      `${activity.durationMS} ms`,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 2) {
        const badge = document.createElement("span");
        badge.className = "mode-badge";
        badge.textContent = value;
        cell.appendChild(badge);
      } else if (index === 3) {
        const result = document.createElement("div");
        result.className = "activity-result";
        const badge = document.createElement("span");
        badge.className = `result-badge ${activity.result === "success" ? "result-success" : "result-error"}`;
        badge.textContent = value;
        result.appendChild(badge);
        if (activity.error) {
          const detailsID = `activity-error-${activity.id}`;
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "error-details-button";
          toggle.textContent = activity.errorExpanded ? "收起" : "查看错误";
          toggle.setAttribute("aria-expanded", String(activity.errorExpanded));
          toggle.setAttribute("aria-controls", detailsID);
          toggle.addEventListener("click", () => {
            activity.errorExpanded = !activity.errorExpanded;
            renderActivity();
          });
          result.appendChild(toggle);
        }
        cell.appendChild(result);
      } else {
        cell.textContent = value;
      }
      if (index === 4) cell.classList.add("numeric");
      if (activity.result === "error") cell.title = activity.message;
      row.appendChild(cell);
    });
    rows.push(row);

    if (activity.error) {
      const detailRow = document.createElement("tr");
      detailRow.id = `activity-error-${activity.id}`;
      detailRow.className = "activity-error-row";
      detailRow.hidden = !activity.errorExpanded;

      const detailCell = document.createElement("td");
      detailCell.colSpan = 5;
      const detail = document.createElement("div");
      detail.className = "activity-error-detail";

      const metadata = document.createElement("dl");
      metadata.className = "activity-error-metadata";
      const fields = [
        ["请求 ID", activity.requestID],
        ["状态码", String(activity.error.status)],
        ["错误码", activity.error.code],
        ["错误信息", activity.error.message],
      ];
      for (const [label, value] of fields) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value;
        metadata.append(term, description);
      }
      detail.appendChild(metadata);

      if (activity.error.body) {
        const bodyLabel = document.createElement("div");
        bodyLabel.className = "activity-error-body-label";
        bodyLabel.textContent = "原始响应";
        const body = document.createElement("pre");
        body.className = "activity-error-body";
        body.textContent = formatErrorBody(activity.error.body);
        detail.append(bodyLabel, body);
      }

      detailCell.appendChild(detail);
      detailRow.appendChild(detailCell);
      rows.push(detailRow);
    }
  }
  elements.activityBody.replaceChildren(...rows);
}

function startDurationTimer() {
  stopDurationTimer();
  const update = () => {
    const elapsed = Math.max(0, Date.now() - state.connectedAt);
    const seconds = Math.floor(elapsed / 1000);
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    elements.connectionDuration.textContent = `${hours}:${minutes}:${remainder}`;
  };
  update();
  state.durationTimer = window.setInterval(update, 1000);
}

function stopDurationTimer() {
  if (state.durationTimer !== null) {
    clearInterval(state.durationTimer);
    state.durationTimer = null;
  }
  if (!state.registered) elements.connectionDuration.textContent = "00:00:00";
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  connect();
});

elements.disconnect.addEventListener("click", disconnect);

elements.keepAliveMode.addEventListener("change", () => {
  void changeKeepAliveMode(elements.keepAliveMode.value);
});

elements.keepAliveVideo.addEventListener("leavepictureinpicture", handlePictureInPictureExit);
elements.keepAliveVideo.addEventListener("webkitpresentationmodechanged", handleWebKitPresentationModeChange);

for (const option of elements.themeOptions) {
  option.addEventListener("click", () => applyThemeMode(option.dataset.themeOption));
}

createIcons({
  icons: { Monitor, Moon, Sun, TriangleAlert, X },
  attrs: { "aria-hidden": "true", "stroke-width": "2" },
});

if (typeof themeMediaQuery.addEventListener === "function") {
  themeMediaQuery.addEventListener("change", handleSystemThemeChange);
} else {
  themeMediaQuery.addListener(handleSystemThemeChange);
}

elements.toggleKey.addEventListener("click", () => {
  const show = elements.apiKey.type === "password";
  elements.apiKey.type = show ? "text" : "password";
  elements.toggleKey.textContent = show ? "隐藏" : "显示";
  elements.toggleKey.setAttribute("aria-label", show ? "隐藏 API Key" : "显示 API Key");
});

elements.clearActivity.addEventListener("click", () => {
  state.activities = [];
  renderActivity();
});

elements.dismissPrefillToast.addEventListener("click", () => {
  elements.prefillToast.hidden = true;
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.keepAliveEnabled && state.keepAliveAudio?.paused) {
    state.keepAliveAudio.play().catch(() => {});
  }
  if (!document.hidden && state.pictureInPictureActive && elements.keepAliveVideo.paused) {
    elements.keepAliveVideo.play().catch(() => {});
  }
});

window.addEventListener("beforeunload", () => {
  state.shouldReconnect = false;
  abortAllRequests();
  stopMobileKeepAlive();
  stopPictureInPictureKeepAlive();
  disposePictureInPictureKeepAlive();
  if (state.socket) state.socket.close(1000, "page unloading");
});

restoreThemeMode();
restoreUserKey();
renderActivity();
updateControls();

if (!supportsPictureInPictureKeepAlive()) {
  const pictureInPictureOption = elements.keepAliveMode.querySelector('option[value="pip"]');
  pictureInPictureOption.disabled = true;
  pictureInPictureOption.textContent = "画中画（不支持）";
} else {
  preparePictureInPictureVideo();
}

if (!BUILD_API_KEY) {
  setStatus("error", "Build API 不可用");
  setMessage("当前 AI Studio Build 环境没有提供 API Key", "error");
}
