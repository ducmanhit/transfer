import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const isConfigured =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes("YOUR_") &&
  !SUPABASE_ANON_KEY.includes("YOUR_");

const els = {
  configError: document.querySelector("#config-error"),
  authView: document.querySelector("#auth-view"),
  chatView: document.querySelector("#chat-view"),
  authForm: document.querySelector("#auth-form"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  loginBtn: document.querySelector("#login-btn"),
  signupBtn: document.querySelector("#signup-btn"),
  authMessage: document.querySelector("#auth-message"),
  logoutBtn: document.querySelector("#logout-btn"),
  statusDot: document.querySelector("#status-dot"),
  connectionStatus: document.querySelector("#connection-status"),
  userStrip: document.querySelector("#user-strip"),
  messages: document.querySelector("#messages"),
  emptyState: document.querySelector("#empty-state"),
  composer: document.querySelector("#composer"),
  messageInput: document.querySelector("#message-input"),
  imageInput: document.querySelector("#image-input"),
  sendBtn: document.querySelector("#send-btn"),
  imagePreviewWrap: document.querySelector("#image-preview-wrap"),
  imagePreview: document.querySelector("#image-preview"),
  previewName: document.querySelector("#preview-name"),
  previewSize: document.querySelector("#preview-size"),
  removeImageBtn: document.querySelector("#remove-image-btn"),
  settingsBtn: document.querySelector("#settings-btn"),
  settingsDialog: document.querySelector("#settings-dialog"),
  deviceNameInput: document.querySelector("#device-name-input"),
  saveDeviceName: document.querySelector("#save-device-name"),
  toast: document.querySelector("#toast"),
};

let supabase = null;
let currentUser = null;
let realtimeChannel = null;
let selectedImage = null;
let selectedPreviewUrl = null;
let toastTimer = null;
const renderedMessageIds = new Set();

if (!isConfigured) {
  els.configError.classList.remove("hidden");
  disableAuth(true);
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  initializeApp();
}

async function initializeApp() {
  bindEvents();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showAuthMessage(error.message);
    return;
  }

  await handleSession(data.session);

  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => handleSession(session), 0);
  });
}

function bindEvents() {
  els.authForm.addEventListener("submit", handleLogin);
  els.signupBtn.addEventListener("click", handleSignup);
  els.logoutBtn.addEventListener("click", handleLogout);
  els.composer.addEventListener("submit", handleSend);
  els.messageInput.addEventListener("input", autoResizeTextarea);
  els.messageInput.addEventListener("keydown", handleComposerKeydown);
  els.imageInput.addEventListener("change", handleImageSelection);
  els.removeImageBtn.addEventListener("click", clearSelectedImage);
  els.settingsBtn.addEventListener("click", openSettings);
  els.saveDeviceName.addEventListener("click", saveDeviceName);
  document.addEventListener("paste", handlePasteImage);
}

async function handleSession(session) {
  currentUser = session?.user ?? null;

  if (!currentUser) {
    await unsubscribeRealtime();
    resetChat();
    els.authView.classList.remove("hidden");
    els.chatView.classList.add("hidden");
    return;
  }

  els.authView.classList.add("hidden");
  els.chatView.classList.remove("hidden");
  els.userStrip.textContent = `Đăng nhập: ${currentUser.email ?? currentUser.id}`;
  setConnectionStatus("Đang tải dữ liệu...", "pending");
  await loadMessages();
  subscribeRealtime();
  els.messageInput.focus();
}

async function handleLogin(event) {
  event.preventDefault();
  if (!validateAuthForm()) return;

  setAuthLoading(true);
  showAuthMessage("");

  const { error } = await supabase.auth.signInWithPassword({
    email: els.email.value.trim(),
    password: els.password.value,
  });

  setAuthLoading(false);
  if (error) showAuthMessage(translateAuthError(error.message));
}

async function handleSignup() {
  if (!validateAuthForm()) return;

  setAuthLoading(true);
  showAuthMessage("");

  const { data, error } = await supabase.auth.signUp({
    email: els.email.value.trim(),
    password: els.password.value,
  });

  setAuthLoading(false);

  if (error) {
    showAuthMessage(translateAuthError(error.message));
    return;
  }

  if (data.session) {
    showAuthMessage("Tạo tài khoản thành công.", true);
  } else {
    showAuthMessage("Đã tạo tài khoản. Hãy kiểm tra email để xác nhận, hoặc tắt Confirm email trong Supabase nếu chỉ dùng cá nhân.", true);
  }
}

async function handleLogout() {
  els.logoutBtn.disabled = true;
  const { error } = await supabase.auth.signOut();
  els.logoutBtn.disabled = false;
  if (error) showToast(error.message, true);
}

function validateAuthForm() {
  const email = els.email.value.trim();
  const password = els.password.value;

  if (!email || !email.includes("@")) {
    showAuthMessage("Hãy nhập email hợp lệ.");
    els.email.focus();
    return false;
  }

  if (password.length < 6) {
    showAuthMessage("Mật khẩu cần ít nhất 6 ký tự.");
    els.password.focus();
    return false;
  }

  return true;
}

async function loadMessages() {
  renderedMessageIds.clear();
  els.messages.querySelectorAll(".message-group").forEach((node) => node.remove());
  els.emptyState.classList.remove("hidden");

  const { data, error } = await supabase
    .from("messages")
    .select("id,user_id,sender_name,body,image_path,created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    setConnectionStatus("Lỗi tải dữ liệu", "offline");
    showToast(`Không tải được tin nhắn: ${error.message}`, true);
    return;
  }

  for (const message of data ?? []) {
    renderMessage(message, false);
  }

  scrollMessagesToBottom(false);
}

function subscribeRealtime() {
  unsubscribeRealtime();

  realtimeChannel = supabase
    .channel(`private-messages-${currentUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `user_id=eq.${currentUser.id}`,
      },
      (payload) => renderMessage(payload.new, true)
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnectionStatus("Realtime đang hoạt động", "online");
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        setConnectionStatus("Mất kết nối, đang thử lại...", "offline");
      } else {
        setConnectionStatus("Đang kết nối...", "pending");
      }
    });
}

async function unsubscribeRealtime() {
  if (supabase && realtimeChannel) {
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function handleSend(event) {
  event.preventDefault();
  if (!currentUser) return;

  const body = els.messageInput.value.trim();
  if (!body && !selectedImage) return;

  setComposerLoading(true);
  let uploadedPath = null;

  try {
    if (selectedImage) {
      const compressed = await compressImage(selectedImage);
      uploadedPath = `${currentUser.id}/${Date.now()}-${crypto.randomUUID()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from("chat-images")
        .upload(uploadedPath, compressed, {
          contentType: "image/webp",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;
    }

    const payload = {
      user_id: currentUser.id,
      sender_name: getDeviceName(),
      body: body || null,
      image_path: uploadedPath,
    };

    const { data, error } = await supabase
      .from("messages")
      .insert(payload)
      .select("id,user_id,sender_name,body,image_path,created_at")
      .single();

    if (error) throw error;

    renderMessage(data, true);
    els.messageInput.value = "";
    autoResizeTextarea();
    clearSelectedImage();
  } catch (error) {
    if (uploadedPath) {
      await supabase.storage.from("chat-images").remove([uploadedPath]);
    }
    showToast(`Gửi thất bại: ${error.message}`, true);
  } finally {
    setComposerLoading(false);
    els.messageInput.focus();
  }
}

function renderMessage(message, shouldScroll = true) {
  if (!message?.id || renderedMessageIds.has(message.id)) return;
  renderedMessageIds.add(message.id);
  els.emptyState.classList.add("hidden");

  const wrapper = document.createElement("article");
  wrapper.className = "message-group";
  wrapper.dataset.id = message.id;
  wrapper.dataset.createdAt = message.created_at;

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const sender = document.createElement("span");
  sender.className = "sender-name";
  sender.textContent = message.sender_name || "Thiết bị";

  const metaRight = document.createElement("span");
  const time = document.createElement("time");
  time.dateTime = message.created_at;
  time.textContent = formatTime(message.created_at);

  const separator = document.createTextNode(" · ");
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-message";
  deleteButton.textContent = "Xóa";
  deleteButton.addEventListener("click", () => deleteMessage(message, wrapper));

  metaRight.append(time, separator, deleteButton);
  meta.append(sender, metaRight);

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (message.image_path) {
    const imageWrap = document.createElement("div");
    imageWrap.className = "message-image-wrap";
    const loading = document.createElement("div");
    loading.className = "image-loading";
    loading.textContent = "Đang tải ảnh...";
    imageWrap.appendChild(loading);
    bubble.appendChild(imageWrap);
    loadPrivateImage(message.image_path, imageWrap);
  }

  if (message.body) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.body;
    bubble.appendChild(text);
  }

  wrapper.append(meta, bubble);
  els.messages.appendChild(wrapper);

  if (shouldScroll) scrollMessagesToBottom(true);
}

async function loadPrivateImage(path, container) {
  const { data, error } = await supabase.storage
    .from("chat-images")
    .createSignedUrl(path, 60 * 60);

  container.replaceChildren();

  if (error || !data?.signedUrl) {
    const errorNode = document.createElement("div");
    errorNode.className = "image-error";
    errorNode.textContent = "Không tải được ảnh hoặc liên kết đã hết hạn. Tải lại trang để tạo liên kết mới.";
    container.appendChild(errorNode);
    return;
  }

  const image = document.createElement("img");
  image.className = "message-image";
  image.loading = "lazy";
  image.alt = "Ảnh đã gửi";
  image.src = data.signedUrl;
  image.addEventListener("click", () => window.open(data.signedUrl, "_blank", "noopener,noreferrer"));
  container.appendChild(image);
}

async function deleteMessage(message, wrapper) {
  if (!window.confirm("Xóa tin nhắn này?")) return;

  const { error } = await supabase.from("messages").delete().eq("id", message.id);
  if (error) {
    showToast(`Không xóa được: ${error.message}`, true);
    return;
  }

  if (message.image_path) {
    await supabase.storage.from("chat-images").remove([message.image_path]);
  }

  wrapper.remove();
  renderedMessageIds.delete(message.id);
  if (!els.messages.querySelector(".message-group")) els.emptyState.classList.remove("hidden");
}

function handleImageSelection(event) {
  const file = event.target.files?.[0];
  if (file) setSelectedImage(file);
}

function handlePasteImage(event) {
  if (!currentUser || els.chatView.classList.contains("hidden")) return;

  const imageItem = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;

  const file = imageItem.getAsFile();
  if (file) {
    event.preventDefault();
    setSelectedImage(file);
    showToast("Đã dán ảnh từ clipboard.");
  }
}

function setSelectedImage(file) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];

  if (!allowed.includes(file.type)) {
    showToast("Chỉ hỗ trợ JPG, PNG hoặc WebP.", true);
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    showToast("Ảnh gốc tối đa 15 MB.", true);
    return;
  }

  clearSelectedImage();
  selectedImage = file;
  selectedPreviewUrl = URL.createObjectURL(file);
  els.imagePreview.src = selectedPreviewUrl;
  els.previewName.textContent = file.name || "Ảnh từ clipboard";
  els.previewSize.textContent = `${formatBytes(file.size)} · sẽ tự nén`;
  els.imagePreviewWrap.classList.remove("hidden");
}

function clearSelectedImage() {
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedImage = null;
  selectedPreviewUrl = null;
  els.imageInput.value = "";
  els.imagePreview.removeAttribute("src");
  els.imagePreviewWrap.classList.add("hidden");
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Không thể nén ảnh."))),
      "image/webp",
      0.82
    );
  });

  if (blob.size > 6 * 1024 * 1024) {
    throw new Error("Ảnh sau khi nén vẫn lớn hơn 6 MB.");
  }

  return blob;
}

function handleComposerKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
}

function autoResizeTextarea() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 150)}px`;
}

function openSettings() {
  els.deviceNameInput.value = getDeviceName();
  els.settingsDialog.showModal();
  requestAnimationFrame(() => els.deviceNameInput.focus());
}

function saveDeviceName(event) {
  event.preventDefault();
  const name = els.deviceNameInput.value.trim().slice(0, 40);
  if (!name) {
    showToast("Tên thiết bị không được để trống.", true);
    return;
  }

  localStorage.setItem("quickroom-device-name", name);
  els.settingsDialog.close();
  showToast(`Đã đổi tên thành “${name}”.`);
}

function getDeviceName() {
  const saved = localStorage.getItem("quickroom-device-name")?.trim();
  if (saved) return saved.slice(0, 40);

  const platform = /Mobi|Android/i.test(navigator.userAgent) ? "Điện thoại" : "Máy tính";
  return platform;
}

function setConnectionStatus(text, state) {
  els.connectionStatus.textContent = text;
  els.statusDot.classList.remove("online", "offline");
  if (state === "online") els.statusDot.classList.add("online");
  if (state === "offline") els.statusDot.classList.add("offline");
}

function resetChat() {
  currentUser = null;
  renderedMessageIds.clear();
  els.messages.querySelectorAll(".message-group").forEach((node) => node.remove());
  els.emptyState.classList.remove("hidden");
  clearSelectedImage();
  els.messageInput.value = "";
  autoResizeTextarea();
  setConnectionStatus("Đã ngắt kết nối", "offline");
}

function setAuthLoading(loading) {
  els.loginBtn.disabled = loading;
  els.signupBtn.disabled = loading;
  els.email.disabled = loading;
  els.password.disabled = loading;
  els.loginBtn.querySelector("span").textContent = loading ? "Đang xử lý..." : "Đăng nhập";
}

function disableAuth(disabled) {
  els.loginBtn.disabled = disabled;
  els.signupBtn.disabled = disabled;
  els.email.disabled = disabled;
  els.password.disabled = disabled;
}

function setComposerLoading(loading) {
  els.sendBtn.disabled = loading;
  els.messageInput.disabled = loading;
  els.imageInput.disabled = loading;
}

function showAuthMessage(message, success = false) {
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle("success", success);
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("show");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function scrollMessagesToBottom(smooth = true) {
  requestAnimationFrame(() => {
    els.messages.scrollTo({
      top: els.messages.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  });
}

function formatTime(value) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  return new Intl.DateTimeFormat("vi-VN", {
    ...(sameDay ? {} : { day: "2-digit", month: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function translateAuthError(message) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "Email hoặc mật khẩu không đúng.";
  if (normalized.includes("email not confirmed")) return "Email chưa được xác nhận.";
  if (normalized.includes("user already registered")) return "Email này đã được đăng ký.";
  if (normalized.includes("password should be")) return "Mật khẩu chưa đủ mạnh hoặc quá ngắn.";
  return message;
}
