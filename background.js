import { ensureUiState, getUiState, setActiveRootId } from "./state.js";

const BOOKMARK_BAR_ID = "1";

configureSidePanel().catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel().catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  configureSidePanel().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function handleMessage(message) {
  await ensureUiState();

  switch (message?.type) {
    case "getState":
      return { ok: true, ...(await buildState()) };
    case "getActiveTab":
      return { ok: true, tab: await getActiveTabInfo() };
    case "setActiveRoot":
      return { ok: true, ...(await setActiveRoot(String(message.rootId ?? ""))) };
    case "createRootFolder":
      return {
        ok: true,
        ...(await createRootFolder(String(message.title ?? "")))
      };
    case "renameNode":
      return {
        ok: true,
        ...(await renameNode(String(message.nodeId ?? ""), String(message.title ?? "")))
      };
    case "deleteNode":
      return { ok: true, ...(await deleteNode(String(message.nodeId ?? ""))) };
    case "createFolder":
      return {
        ok: true,
        ...(await createFolder(String(message.parentId ?? ""), String(message.title ?? "")))
      };
    case "createBookmark":
      return {
        ok: true,
        ...(await createBookmark({
          parentId: String(message.parentId ?? ""),
          title: String(message.title ?? ""),
          url: String(message.url ?? ""),
          index: typeof message.index === "number" ? message.index : undefined
        }))
      };
    case "updateBookmark":
      return {
        ok: true,
        ...(await updateBookmark({
          nodeId: String(message.nodeId ?? ""),
          title: String(message.title ?? ""),
          url: String(message.url ?? "")
        }))
      };
    case "moveNode":
      return {
        ok: true,
        ...(await moveNode({
          nodeId: String(message.nodeId ?? ""),
          parentId: String(message.parentId ?? ""),
          index: typeof message.index === "number" ? message.index : undefined
        }))
      };
    case "openBookmark":
      await openBookmark(String(message.url ?? ""));
      return { ok: true };
    default:
      throw new Error("Unknown message type.");
  }
}

async function configureSidePanel() {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
}

async function buildState() {
  const bookmarkBarChildren = await getBookmarkBarChildren();
  const uiState = await getUiState();
  const rootFolders = bookmarkBarChildren.filter((node) => !node.url);
  const validRootIds = new Set(rootFolders.map((root) => root.id));

  let activeRootId = uiState.activeRootId;
  if (!activeRootId || !validRootIds.has(activeRootId)) {
    activeRootId = rootFolders[0]?.id ?? null;
    await setActiveRootId(activeRootId);
  }

  const roots = bookmarkBarChildren.map((node) => mapBookmarkNode(node));
  const activeRoot = roots.find((node) => node.id === activeRootId) ?? null;

  return {
    activeRootId,
    roots,
    activeRoot
  };
}

async function setActiveRoot(rootId) {
  const roots = (await getBookmarkBarChildren()).filter((root) => !root.url);
  const found = roots.find((root) => root.id === rootId);
  if (!found) {
    throw new Error("Root folder not found.");
  }

  await setActiveRootId(found.id);
  return buildState();
}

async function createRootFolder(title) {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Folder name is required.");
  }

  const node = await bookmarksCreate({
    parentId: BOOKMARK_BAR_ID,
    title: trimmed
  });

  await setActiveRootId(node.id);
  return buildState();
}

async function renameNode(nodeId, title) {
  const trimmed = title.trim();
  if (!nodeId || !trimmed) {
    throw new Error("Node id and title are required.");
  }

  await bookmarksUpdate(nodeId, { title: trimmed });
  return buildState();
}

async function deleteNode(nodeId) {
  if (!nodeId) {
    throw new Error("Node id is required.");
  }

  const node = await getNode(nodeId);
  if (node.url) {
    await bookmarksRemove(nodeId);
  } else {
    await bookmarksRemoveTree(nodeId);
  }

  return buildState();
}

async function createFolder(parentId, title) {
  const trimmed = title.trim();
  if (!parentId || !trimmed) {
    throw new Error("Parent folder and title are required.");
  }

  await ensureFolder(parentId);
  await bookmarksCreate({ parentId, title: trimmed });
  return buildState();
}

async function createBookmark({ parentId, title, url, index }) {
  const trimmedUrl = normalizeUrl(url);
  const trimmedTitle = title.trim() || trimmedUrl;
  if (!parentId || !trimmedUrl) {
    throw new Error("Parent folder and URL are required.");
  }

  await ensureFolder(parentId);

  const payload = {
    parentId,
    title: trimmedTitle,
    url: trimmedUrl
  };

  if (typeof index === "number") {
    payload.index = index;
  }

  await bookmarksCreate(payload);
  return buildState();
}

async function updateBookmark({ nodeId, title, url }) {
  const trimmedUrl = normalizeUrl(url);
  const trimmedTitle = title.trim() || trimmedUrl;
  if (!nodeId || !trimmedUrl) {
    throw new Error("Bookmark id and URL are required.");
  }

  const node = await getNode(nodeId);
  if (!node.url) {
    throw new Error("Only bookmarks can be edited.");
  }

  await bookmarksUpdate(nodeId, {
    title: trimmedTitle,
    url: trimmedUrl
  });
  return buildState();
}

async function moveNode({ nodeId, parentId, index }) {
  if (!nodeId || !parentId || typeof index !== "number") {
    throw new Error("Move target is incomplete.");
  }

  const moving = await getNode(nodeId);
  const destination = await getNode(parentId);
  if (destination.url) {
    throw new Error("Destination must be a folder.");
  }

  if (!moving.url && moving.parentId === BOOKMARK_BAR_ID) {
    throw new Error("Top-level bookmark-bar folders stay at the root.");
  }

  if (!moving.url) {
    if (moving.id === destination.id) {
      throw new Error("Cannot move a folder into itself.");
    }
    const descendantIds = await getDescendantFolderIds(moving.id);
    if (descendantIds.has(destination.id)) {
      throw new Error("Cannot move a folder into one of its descendants.");
    }
  }

  const destinationChildren = await getChildren(parentId);
  const boundedIndex = Math.max(0, Math.min(index, destinationChildren.length));
  const finalIndex =
    moving.parentId === parentId && typeof moving.index === "number" && boundedIndex > moving.index
      ? boundedIndex - 1
      : boundedIndex;

  await bookmarksMove(nodeId, {
    parentId,
    index: finalIndex
  });

  return buildState();
}

async function openBookmark(url) {
  const targetUrl = normalizeUrl(url);
  if (!targetUrl) {
    throw new Error("Bookmark URL is required.");
  }

  const tabs = await tabsQuery({
    active: true,
    lastFocusedWindow: true
  });

  const activeTab = tabs[0];
  if (activeTab?.id !== undefined) {
    try {
      await tabsUpdate(activeTab.id, { url: targetUrl });
      return;
    } catch (_error) {
      // Fall through to opening a new tab when the active tab cannot be updated.
    }
  }

  await tabsCreate({ url: targetUrl });
}

async function getActiveTabInfo() {
  const tabs = await tabsQuery({
    active: true,
    lastFocusedWindow: true
  });
  const tab = tabs[0];
  if (!tab?.url) {
    return null;
  }

  return {
    title: tab.title ?? tab.url,
    url: tab.url
  };
}

async function getBookmarkBarChildren() {
  return getChildren(BOOKMARK_BAR_ID);
}

function mapBookmarkNode(node) {
  const isFolder = !node.url;
  return {
    id: node.id,
    type: isFolder ? "folder" : "bookmark",
    title: node.title || (isFolder ? "Untitled folder" : node.url || "Untitled bookmark"),
    url: node.url,
    editable: node.id !== BOOKMARK_BAR_ID,
    parentId: node.parentId ?? null,
    index: typeof node.index === "number" ? node.index : 0,
    children: isFolder
      ? (node.children ?? []).map((child) => mapBookmarkNode(child))
      : undefined
  };
}

async function ensureFolder(nodeId) {
  const node = await getNode(nodeId);
  if (node.url) {
    throw new Error("Target must be a folder.");
  }
  return node;
}

async function getNode(nodeId) {
  const results = await bookmarksGetSubTree(nodeId);
  const node = results?.[0];
  if (!node) {
    throw new Error("Bookmark node not found.");
  }
  return node;
}

async function getChildren(nodeId) {
  return bookmarksGetChildren(nodeId);
}

async function getDescendantFolderIds(nodeId) {
  const root = await getNode(nodeId);
  const ids = new Set();
  walkFolders(root, ids);
  ids.delete(nodeId);
  return ids;
}

function walkFolders(node, ids) {
  if (!node || node.url) {
    return;
  }

  ids.add(node.id);
  for (const child of node.children ?? []) {
    walkFolders(child, ids);
  }
}

function normalizeUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).toString();
  } catch (_error) {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch (_secondError) {
      throw new Error("Please enter a valid URL.");
    }
  }
}

function bookmarksCreate(payload) {
  return chrome.bookmarks.create(payload);
}

function bookmarksUpdate(id, changes) {
  return chrome.bookmarks.update(id, changes);
}

function bookmarksMove(id, destination) {
  return chrome.bookmarks.move(id, destination);
}

function bookmarksRemove(id) {
  return chrome.bookmarks.remove(id);
}

function bookmarksRemoveTree(id) {
  return chrome.bookmarks.removeTree(id);
}

function bookmarksGetChildren(id) {
  return chrome.bookmarks.getChildren(id);
}

function bookmarksGetSubTree(id) {
  return chrome.bookmarks.getSubTree(id);
}

function tabsQuery(queryInfo) {
  return chrome.tabs.query(queryInfo);
}

function tabsUpdate(tabId, updateProperties) {
  return chrome.tabs.update(tabId, updateProperties);
}

function tabsCreate(createProperties) {
  return chrome.tabs.create(createProperties);
}
