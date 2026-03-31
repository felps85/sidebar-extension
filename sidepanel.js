const rootTriggerTitle = document.getElementById("rootTriggerTitle");
const rootMenuList = document.getElementById("rootMenuList");
const renameRootBtn = document.getElementById("renameRootBtn");
const topAddBookmarkBtn = document.getElementById("topAddBookmarkBtn");
const topAddFolderBtn = document.getElementById("topAddFolderBtn");
const deleteRootBtn = document.getElementById("deleteRootBtn");
const createRootForm = document.getElementById("createRootForm");
const createRootInput = document.getElementById("createRootInput");
const createSubfolderForm = document.getElementById("createSubfolderForm");
const createSubfolderInput = document.getElementById("createSubfolderInput");
const treeRoot = document.getElementById("treeRoot");
const statusToast = document.getElementById("statusToast");
const folderTemplate = document.getElementById("folderTemplate");
const bookmarkTemplate = document.getElementById("bookmarkTemplate");

const BOOKMARK_BAR_ID = "1";
const COLLAPSE_KEY = "sidebarFavoritesCollapseState";
const DRAG_MIME = "application/x-sidebar-favorites-node";
const TOAST_TIMEOUT_MS = 3600;

let appState = {
  activeRootId: null,
  roots: [],
  activeRoot: null
};

let collapseState = loadCollapseState();
let dragState = null;
let toastTimeoutId = 0;
let faviconRefreshTokens = {};

boot().catch((error) => {
  handleActionError(error);
  treeRoot.innerHTML = `<div class="empty-state">${escapeHtml(
    error instanceof Error ? error.message : String(error)
  )}</div>`;
});

async function boot() {
  wireHeader();
  wireGlobalErrors();
  wireRuntimeRefresh();
  await refreshState();
}

function wireHeader() {
  renameRootBtn.addEventListener("click", () => {
    void runUserAction(async () => {
      const root = getActiveRootSummary();
      if (!root) {
        return;
      }

      const title = prompt("Rename top-level folder", root.title);
      if (!title || !title.trim()) {
        return;
      }

      await requestState({
        type: "renameNode",
        nodeId: root.id,
        title: title.trim()
      });
    });
  });

  topAddBookmarkBtn.addEventListener("click", () => {
    void runUserAction(async () => {
      if (!appState.activeRoot) {
        return;
      }
      await promptCreateBookmark(appState.activeRoot.id);
    });
  });

  topAddFolderBtn.addEventListener("click", () => {
    void runUserAction(async () => {
      if (!appState.activeRoot) {
        return;
      }
      await promptCreateFolder(appState.activeRoot.id);
    });
  });

  deleteRootBtn.addEventListener("click", () => {
    void runUserAction(async () => {
      const root = getActiveRootSummary();
      if (!root) {
        return;
      }

      if (!confirm(`Delete "${root.title}" and everything inside it?`)) {
        return;
      }

      await requestState({
        type: "deleteNode",
        nodeId: root.id
      });
    });
  });

  createRootForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runUserAction(async () => {
      const title = createRootInput.value.trim();
      if (!title) {
        return;
      }

      await requestState({
        type: "createRootFolder",
        title
      });

      createRootInput.value = "";
    });
  });

  createSubfolderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runUserAction(async () => {
      if (!appState.activeRoot) {
        return;
      }

      const title = createSubfolderInput.value.trim();
      if (!title) {
        return;
      }

      await requestState({
        type: "createFolder",
        parentId: appState.activeRoot.id,
        title
      });

      createSubfolderInput.value = "";
    });
  });
}

function wireGlobalErrors() {
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    handleActionError(event.reason);
  });
}

function wireRuntimeRefresh() {
  const events = chrome?.bookmarks;
  for (const key of [
    "onCreated",
    "onRemoved",
    "onChanged",
    "onMoved",
    "onChildrenReordered"
  ]) {
    events?.[key]?.addListener?.(() => {
      refreshState().catch(handleActionError);
    });
  }
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "getState" });
  if (!response?.ok) {
    throw new Error(response?.error ?? "Failed to load bookmark state.");
  }

  applyState(response);
}

function applyState(nextState) {
  appState = {
    activeRootId: nextState.activeRootId ?? null,
    roots: Array.isArray(nextState.roots) ? nextState.roots : [],
    activeRoot: nextState.activeRoot ?? null
  };

  renderRootPicker();
  renderTree();
}

function renderRootPicker() {
  rootMenuList.replaceChildren();

  const activeRoot = getActiveRootSummary();
  rootTriggerTitle.textContent = activeRoot?.title ?? "No folder selected";
  renameRootBtn.disabled = !activeRoot;
  topAddBookmarkBtn.disabled = !activeRoot;
  topAddFolderBtn.disabled = !activeRoot;
  deleteRootBtn.disabled = !activeRoot;
  createSubfolderInput.disabled = !activeRoot;
  createSubfolderForm.querySelector("button").disabled = !activeRoot;

  for (const root of appState.roots.filter((node) => node.type === "folder")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "root-option";
    button.textContent = root.title;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(root.id === appState.activeRootId));
    if (root.id === appState.activeRootId) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", () => {
      void runUserAction(async () => {
        await requestState({
          type: "setActiveRoot",
          rootId: root.id
        });
      });
    });
    rootMenuList.appendChild(button);
  }
}

function renderTree() {
  clearDragIndicators();
  treeRoot.replaceChildren();

  if (!appState.roots.length) {
    treeRoot.innerHTML =
      '<div class="empty-state">Create a bookmark-bar folder to start building your sidebar favorites.</div>';
    return;
  }

  for (const node of appState.roots) {
    if (node.type === "folder") {
      treeRoot.appendChild(renderFolderNode(node, true));
    } else {
      treeRoot.appendChild(renderBookmarkNode(node));
    }
  }
}

function renderFolderNode(folder, isActiveRoot = false) {
  const fragment = folderTemplate.content.firstElementChild.cloneNode(true);
  const row = fragment.querySelector(".folder-row");
  const chevron = fragment.querySelector(".row-chevron");
  const titleButton = fragment.querySelector(".folder-title");
  const meta = fragment.querySelector(".folder-meta");
  const childrenContainer = fragment.querySelector(".folder-children");
  const addBookmarkBtn = fragment.querySelector(".add-bookmark");
  const addFolderBtn = fragment.querySelector(".add-folder");
  const renameBtn = fragment.querySelector(".rename-folder");
  const deleteBtn = fragment.querySelector(".delete-folder");

  fragment.dataset.nodeId = folder.id;
  row.dataset.nodeId = folder.id;
  row.dataset.nodeType = folder.type;
  row.dataset.parentId = folder.parentId ?? "";
  row.dataset.index = String(folder.index ?? 0);

  titleButton.textContent = folder.title;
  meta.textContent = formatFolderMeta(folder);
  titleButton.title = folder.title;

  if (isActiveRoot && folder.id === appState.activeRootId) {
    row.classList.add("is-selected-root");
  }

  if (isFolderCollapsed(folder.id)) {
    fragment.classList.add("is-collapsed");
  }

  if (!folder.editable || isActiveRoot) {
    row.draggable = false;
    if (!folder.editable) {
      addBookmarkBtn.hidden = true;
      addFolderBtn.hidden = true;
      renameBtn.hidden = true;
      deleteBtn.hidden = true;
    }
  }

  row.addEventListener("dragstart", (event) => {
    if (!folder.editable || isActiveRoot) {
      event.preventDefault();
      return;
    }

    dragState = {
      id: folder.id,
      type: "folder",
      parentId: folder.parentId,
      index: folder.index
    };
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragState));
  });

  row.addEventListener("dragend", () => {
    row.classList.remove("is-dragging");
    dragState = null;
    clearDragIndicators();
  });

  const toggleFolder = () => {
    setFolderCollapsed(folder.id, !isFolderCollapsed(folder.id));
    fragment.classList.toggle("is-collapsed", isFolderCollapsed(folder.id));
  };

  row.addEventListener("click", (event) => {
    if (event.target.closest(".row-actions") || event.target.closest(".row-chevron")) {
      return;
    }
    if (isActiveRoot) {
      void runUserAction(async () => {
        if (folder.id !== appState.activeRootId) {
          await requestState({
            type: "setActiveRoot",
            rootId: folder.id
          });
        }
      });
      return;
    }
    toggleFolder();
  });

  chevron.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFolder();
  });

  addBookmarkBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runUserAction(async () => {
      await promptCreateBookmark(folder.id);
    });
  });

  addFolderBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runUserAction(async () => {
      await promptCreateFolder(folder.id);
    });
  });

  renameBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runUserAction(async () => {
      const title = prompt("Rename folder", folder.title);
      if (!title || !title.trim()) {
        return;
      }
      await requestState({
        type: "renameNode",
        nodeId: folder.id,
        title: title.trim()
      });
    });
  });

  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runUserAction(async () => {
      if (!confirm(`Delete "${folder.title}" and everything inside it?`)) {
        return;
      }

      await requestState({
        type: "deleteNode",
        nodeId: folder.id
      });
    });
  });

  wireFolderDropTargets(row, folder, {
    dropParentId: folder.id,
    dropIndex: Array.isArray(folder.children) ? folder.children.length : 0
  });

  const childrenDropzone = document.createElement("div");
  childrenDropzone.className = "children-dropzone";
  childrenContainer.appendChild(childrenDropzone);
  wireFolderDropTargets(childrenDropzone, folder, {
    dropParentId: folder.id,
    dropIndex: Array.isArray(folder.children) ? folder.children.length : 0,
    rawOnlyIfEmpty: false
  });

  for (const child of folder.children ?? []) {
    if (child.type === "folder") {
      childrenContainer.appendChild(renderFolderNode(child));
    } else {
      childrenContainer.appendChild(renderBookmarkNode(child));
    }
  }

  return fragment;
}

function renderBookmarkNode(bookmark) {
  const fragment = bookmarkTemplate.content.firstElementChild.cloneNode(true);
  const row = fragment.querySelector(".bookmark-row");
  const titleButton = fragment.querySelector(".bookmark-title");
  const meta = fragment.querySelector(".bookmark-meta");
  const editBtn = fragment.querySelector(".edit-bookmark");
  const deleteBtn = fragment.querySelector(".delete-bookmark");
  const favicon = fragment.querySelector(".bookmark-favicon");
  const avatar = fragment.querySelector(".bookmark-avatar");

  fragment.dataset.nodeId = bookmark.id;
  row.dataset.nodeId = bookmark.id;
  row.dataset.nodeType = bookmark.type;
  row.dataset.parentId = bookmark.parentId ?? "";
  row.dataset.index = String(bookmark.index ?? 0);

  titleButton.textContent = bookmark.title;
  titleButton.title = bookmark.title;
  meta.textContent = formatBookmarkMeta(bookmark.url);

  favicon.addEventListener("load", () => {
    avatar.classList.add("has-image");
  });
  favicon.addEventListener("error", () => {
    avatar.classList.remove("has-image");
  });
  applyFavicon(favicon, avatar, bookmark);

  if (!bookmark.editable) {
    row.draggable = false;
    editBtn.hidden = true;
    deleteBtn.hidden = true;
  }

  titleButton.addEventListener("click", () => {
    void runUserAction(async () => {
      queueFaviconRefresh(favicon, avatar, bookmark);
      await sendMessage({
        type: "openBookmark",
        url: bookmark.url
      });
    });
  });

  editBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runUserAction(async () => {
      const next = await promptBookmarkValues({
        title: bookmark.title,
        url: bookmark.url
      });
      if (!next) {
        return;
      }

      await requestState({
        type: "updateBookmark",
        nodeId: bookmark.id,
        title: next.title,
        url: next.url
      });
    });
  });

  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runUserAction(async () => {
      if (!confirm(`Delete "${bookmark.title}"?`)) {
        return;
      }
      await requestState({
        type: "deleteNode",
        nodeId: bookmark.id
      });
    });
  });

  row.addEventListener("dragstart", (event) => {
    if (!bookmark.editable) {
      event.preventDefault();
      return;
    }

    dragState = {
      id: bookmark.id,
      type: "bookmark",
      parentId: bookmark.parentId,
      index: bookmark.index
    };
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragState));
  });

  row.addEventListener("dragend", () => {
    row.classList.remove("is-dragging");
    dragState = null;
    clearDragIndicators();
  });

  row.addEventListener("dragover", (event) => {
    const payload = getDragPayload(event.dataTransfer);
    const rawUrl = getRawUrlFromDataTransfer(event.dataTransfer);
    if (!payload && !rawUrl) {
      return;
    }

    if (payload && !canMovePayloadToParent(payload, bookmark.parentId)) {
      clearDragIndicators();
      return;
    }

    event.preventDefault();
    row.classList.remove("drag-before", "drag-after", "is-raw-url-target");
    clearDragIndicators(row);

    if (rawUrl) {
      row.classList.add("is-raw-url-target");
      row.classList.add("drag-after");
      return;
    }

    const position = getBookmarkDropPosition(event, row);
    row.classList.add(position === "before" ? "drag-before" : "drag-after");
  });

  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget)) {
      row.classList.remove("drag-before", "drag-after", "is-raw-url-target");
    }
  });

  row.addEventListener("drop", async (event) => {
    const payload = getDragPayload(event.dataTransfer);
    const rawUrl = getRawUrlFromDataTransfer(event.dataTransfer);
    clearDragIndicators();

    if (rawUrl) {
      event.preventDefault();
      const position = getBookmarkDropPosition(event, row);
      const index = position === "before" ? bookmark.index : bookmark.index + 1;
      void runUserAction(async () => {
        await promptCreateBookmark(bookmark.parentId, {
          initialUrl: rawUrl,
          index
        });
      });
      return;
    }

    if (!payload) {
      return;
    }

    if (!canMovePayloadToParent(payload, bookmark.parentId)) {
      return;
    }

    event.preventDefault();
    const position = getBookmarkDropPosition(event, row);
    const index = position === "before" ? bookmark.index : bookmark.index + 1;
    void runUserAction(async () => {
      await requestState({
        type: "moveNode",
        nodeId: payload.id,
        parentId: bookmark.parentId,
        index
      });
    });
  });

  return fragment;
}

function wireFolderDropTargets(element, folder, target) {
  element.addEventListener("dragover", (event) => {
    const payload = getDragPayload(event.dataTransfer);
    const rawUrl = getRawUrlFromDataTransfer(event.dataTransfer);
    if (!payload && !rawUrl) {
      return;
    }

    if (payload && !canMovePayloadToParent(payload, target.dropParentId)) {
      clearDragIndicators();
      return;
    }

    event.preventDefault();
    element.classList.remove("is-drop-target", "is-raw-url-target");
    clearDragIndicators(element);
    element.classList.add(rawUrl ? "is-raw-url-target" : "is-drop-target");
  });

  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove("is-drop-target", "is-raw-url-target");
    }
  });

  element.addEventListener("drop", async (event) => {
    const payload = getDragPayload(event.dataTransfer);
    const rawUrl = getRawUrlFromDataTransfer(event.dataTransfer);
    clearDragIndicators();

    if (!payload && !rawUrl) {
      return;
    }

    event.preventDefault();

    if (rawUrl) {
      void runUserAction(async () => {
        await promptCreateBookmark(folder.id, {
          initialUrl: rawUrl,
          index: target.dropIndex
        });
      });
      return;
    }

    if (!canMovePayloadToParent(payload, target.dropParentId)) {
      return;
    }

    void runUserAction(async () => {
      await requestState({
        type: "moveNode",
        nodeId: payload.id,
        parentId: target.dropParentId,
        index: target.dropIndex
      });
    });
  });
}

async function promptCreateFolder(parentId) {
  const title = prompt("Folder name");
  if (!title || !title.trim()) {
    return;
  }

  await requestState({
    type: "createFolder",
    parentId,
    title: title.trim()
  });
}

async function promptCreateBookmark(parentId, options = {}) {
  const activeTabResponse = await sendMessage({ type: "getActiveTab" });
  const activeTab = activeTabResponse?.ok ? activeTabResponse.tab : null;
  const preset = {
    title: options.initialTitle ?? activeTab?.title ?? "",
    url: options.initialUrl ?? activeTab?.url ?? ""
  };

  const values = await promptBookmarkValues(preset);
  if (!values) {
    return;
  }

  await requestState({
    type: "createBookmark",
    parentId,
    title: values.title,
    url: values.url,
    index: options.index
  });
}

async function promptBookmarkValues(initial) {
  const title = prompt("Bookmark title", initial.title ?? "");
  if (title === null) {
    return null;
  }

  const url = prompt("Bookmark URL", initial.url ?? "");
  if (url === null) {
    return null;
  }

  return {
    title: title.trim(),
    url: url.trim()
  };
}

async function requestState(message) {
  const response = await sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error ?? "Request failed.");
  }
  applyState(response);
  return response;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function getActiveRootSummary() {
  return appState.roots.find((root) => root.type === "folder" && root.id === appState.activeRootId) ?? null;
}

function getBookmarkDropPosition(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function canMovePayloadToParent(payload, parentId) {
  if (!payload || !parentId) {
    return false;
  }

  if (payload.type === "folder" && payload.parentId === BOOKMARK_BAR_ID) {
    return false;
  }

  if (payload.type === "folder") {
    if (payload.id === parentId) {
      return false;
    }

    if (isDescendantNode(parentId, payload.id)) {
      return false;
    }
  }

  return true;
}

function isDescendantNode(candidateId, ancestorId) {
  let current = findNodeById(appState.roots, candidateId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = findNodeById(appState.roots, current.parentId);
  }
  return false;
}

function findNodeById(node, nodeId) {
  if (!node || !nodeId) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNodeById(child, nodeId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (node.id === nodeId) {
    return node;
  }

  for (const child of node.children ?? []) {
    const found = findNodeById(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

function getDragPayload(dataTransfer) {
  if (!dataTransfer) {
    return dragState;
  }

  const raw = dataTransfer.getData(DRAG_MIME);
  if (!raw) {
    return dragState;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return dragState;
  }
}

function getRawUrlFromDataTransfer(dataTransfer) {
  if (!dataTransfer) {
    return "";
  }

  const uriList = dataTransfer.getData("text/uri-list");
  const plain = dataTransfer.getData("text/plain");
  const candidate = [uriList, plain]
    .map((value) => String(value ?? "").trim())
    .find(Boolean);

  if (!candidate) {
    return "";
  }

  const url = candidate.split("\n").find((line) => line && !line.startsWith("#")) ?? candidate;

  try {
    return new URL(url).toString();
  } catch (_error) {
    return "";
  }
}

function applyFavicon(favicon, avatar, bookmark) {
  avatar.classList.remove("has-image");
  favicon.src = getFaviconUrl(bookmark.url, bookmark.id);
}

function queueFaviconRefresh(favicon, avatar, bookmark) {
  bumpFaviconToken(bookmark.id);
  applyFavicon(favicon, avatar, bookmark);

  window.setTimeout(() => {
    bumpFaviconToken(bookmark.id);
    applyFavicon(favicon, avatar, bookmark);
  }, 1200);
}

function bumpFaviconToken(bookmarkId) {
  faviconRefreshTokens = {
    ...faviconRefreshTokens,
    [bookmarkId]: Date.now()
  };
}

function getFaviconUrl(url, bookmarkId) {
  if (!url) {
    return "";
  }

  try {
    const token = faviconRefreshTokens[bookmarkId] ?? 0;
    if (window.location.pathname.endsWith("/preview.html") || window.location.pathname.endsWith("preview.html")) {
      return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url)}&v=${token}`;
    }
    const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
    faviconUrl.searchParams.set("pageUrl", url);
    faviconUrl.searchParams.set("size", "32");
    faviconUrl.searchParams.set("v", String(token));
    return faviconUrl.toString();
  } catch (_error) {
    return "";
  }
}

function formatFolderMeta(folder) {
  const count = Array.isArray(folder.children) ? folder.children.length : 0;
  return `${count} item${count === 1 ? "" : "s"}`;
}

function formatBookmarkMeta(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname.replace(/\/$/, "");
  } catch (_error) {
    return url;
  }
}

function isFolderCollapsed(folderId) {
  return Boolean(collapseState[folderId]);
}

function setFolderCollapsed(folderId, collapsed) {
  collapseState = {
    ...collapseState,
    [folderId]: collapsed
  };
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapseState));
}

function loadCollapseState() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
}

function clearDragIndicators(except) {
  for (const element of document.querySelectorAll(
    ".is-drop-target, .is-raw-url-target, .drag-before, .drag-after"
  )) {
    if (element !== except) {
      element.classList.remove("is-drop-target", "is-raw-url-target", "drag-before", "drag-after");
    }
  }
}

async function runUserAction(action, options = {}) {
  try {
    return await action();
  } catch (error) {
    handleActionError(error);
    return options.fallback ?? null;
  }
}

function handleActionError(error) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  showToast(message || "Something went wrong.");
}

function showToast(message) {
  if (!statusToast) {
    return;
  }

  statusToast.textContent = message;
  statusToast.hidden = false;

  clearTimeout(toastTimeoutId);
  toastTimeoutId = window.setTimeout(() => {
    statusToast.hidden = true;
  }, TOAST_TIMEOUT_MS);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
