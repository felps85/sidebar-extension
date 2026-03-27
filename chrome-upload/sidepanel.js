const rootTrigger = document.getElementById("rootTrigger");
const rootTriggerTitle = document.getElementById("rootTriggerTitle");
const rootMenu = document.getElementById("rootMenu");
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
const folderTemplate = document.getElementById("folderTemplate");
const bookmarkTemplate = document.getElementById("bookmarkTemplate");

const COLLAPSE_KEY = "sidebarFavoritesCollapseState";
const DRAG_MIME = "application/x-sidebar-favorites-node";

let appState = {
  activeRootId: null,
  roots: [],
  activeRoot: null
};

let collapseState = loadCollapseState();
let dragState = null;

boot().catch((error) => {
  console.error(error);
  treeRoot.innerHTML = `<div class="empty-state">${escapeHtml(
    error instanceof Error ? error.message : String(error)
  )}</div>`;
});

async function boot() {
  wireHeader();
  wireRuntimeRefresh();
  await refreshState();
}

function wireHeader() {
  rootTrigger.addEventListener("click", () => {
    const open = rootMenu.hidden;
    setRootMenuOpen(open);
  });

  document.addEventListener("click", (event) => {
    if (!rootMenu.hidden && !event.target.closest(".root-picker")) {
      setRootMenuOpen(false);
    }
  });

  renameRootBtn.addEventListener("click", async () => {
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

  topAddBookmarkBtn.addEventListener("click", async () => {
    if (!appState.activeRoot) {
      return;
    }
    await promptCreateBookmark(appState.activeRoot.id);
  });

  topAddFolderBtn.addEventListener("click", async () => {
    if (!appState.activeRoot) {
      return;
    }
    await promptCreateFolder(appState.activeRoot.id);
  });

  deleteRootBtn.addEventListener("click", async () => {
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

  createRootForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = createRootInput.value.trim();
    if (!title) {
      return;
    }

    const nextState = await requestState({
      type: "createRootFolder",
      title
    });

    createRootInput.value = "";
    applyState(nextState);
  });

  createSubfolderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!appState.activeRoot) {
      return;
    }

    const title = createSubfolderInput.value.trim();
    if (!title) {
      return;
    }

    const nextState = await requestState({
      type: "createFolder",
      parentId: appState.activeRoot.id,
      title
    });

    createSubfolderInput.value = "";
    applyState(nextState);
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
      refreshState().catch(console.error);
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

  for (const root of appState.roots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "root-option";
    button.textContent = root.title;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(root.id === appState.activeRootId));
    if (root.id === appState.activeRootId) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", async () => {
      const nextState = await requestState({
        type: "setActiveRoot",
        rootId: root.id
      });
      applyState(nextState);
      setRootMenuOpen(false);
    });
    rootMenuList.appendChild(button);
  }
}

function renderTree() {
  clearDragIndicators();
  treeRoot.replaceChildren();

  if (!appState.activeRoot) {
    treeRoot.innerHTML =
      '<div class="empty-state">Create a bookmark-bar folder to start building your sidebar favorites.</div>';
    return;
  }

  const rootNode = renderFolderNode(appState.activeRoot, true);
  treeRoot.appendChild(rootNode);
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

  if (isFolderCollapsed(folder.id)) {
    fragment.classList.add("is-collapsed");
  }

  if (!folder.editable) {
    row.draggable = false;
    addBookmarkBtn.hidden = true;
    addFolderBtn.hidden = true;
    renameBtn.hidden = true;
    deleteBtn.hidden = true;
  }

  row.addEventListener("dragstart", (event) => {
    if (!folder.editable) {
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
    toggleFolder();
  });

  chevron.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFolder();
  });

  titleButton.addEventListener("click", toggleFolder);

  addBookmarkBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    await promptCreateBookmark(folder.id);
  });

  addFolderBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    await promptCreateFolder(folder.id);
  });

  renameBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
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

  deleteBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!confirm(`Delete "${folder.title}" and everything inside it?`)) {
      return;
    }

    await requestState({
      type: "deleteNode",
      nodeId: folder.id
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

  const faviconUrl = getFaviconUrl(bookmark.url);
  favicon.src = faviconUrl;
  favicon.addEventListener("load", () => {
    avatar.classList.add("has-image");
  });
  favicon.addEventListener("error", () => {
    avatar.classList.remove("has-image");
  });

  if (!bookmark.editable) {
    row.draggable = false;
    editBtn.hidden = true;
    deleteBtn.hidden = true;
  }

  titleButton.addEventListener("click", async () => {
    await sendMessage({
      type: "openBookmark",
      url: bookmark.url
    });
  });

  editBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
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

  deleteBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!confirm(`Delete "${bookmark.title}"?`)) {
      return;
    }
    await requestState({
      type: "deleteNode",
      nodeId: bookmark.id
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
      await promptCreateBookmark(bookmark.parentId, {
        initialUrl: rawUrl,
        index
      });
      return;
    }

    if (!payload) {
      return;
    }

    event.preventDefault();
    const position = getBookmarkDropPosition(event, row);
    const index = position === "before" ? bookmark.index : bookmark.index + 1;
    await requestState({
      type: "moveNode",
      nodeId: payload.id,
      parentId: bookmark.parentId,
      index
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
      await promptCreateBookmark(folder.id, {
        initialUrl: rawUrl,
        index: target.dropIndex
      });
      return;
    }

    await requestState({
      type: "moveNode",
      nodeId: payload.id,
      parentId: target.dropParentId,
      index: target.dropIndex
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

function setRootMenuOpen(open) {
  rootMenu.hidden = !open;
  rootTrigger.setAttribute("aria-expanded", String(open));
}

function getActiveRootSummary() {
  return appState.roots.find((root) => root.id === appState.activeRootId) ?? null;
}

function getBookmarkDropPosition(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
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

function getFaviconUrl(url) {
  if (!url) {
    return "";
  }

  try {
    if (window.location.pathname.endsWith("/preview.html") || window.location.pathname.endsWith("preview.html")) {
      return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url)}`;
    }
    return `chrome://favicon2/?size=32&pageUrl=${encodeURIComponent(url)}`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
