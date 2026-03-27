(() => {
  const STORAGE_KEY = "sidebarFavoritesPreviewState";
  const BOOKMARK_BAR_ID = "1";

  const listeners = {
    onCreated: createEvent(),
    onRemoved: createEvent(),
    onChanged: createEvent(),
    onMoved: createEvent(),
    onChildrenReordered: createEvent()
  };

  const previewChrome = {
    runtime: {
      async sendMessage(message, callback) {
        const promise = handleMessage(message)
          .then((value) => {
            if (typeof callback === "function") {
              callback(value);
            }
            return value;
          })
          .catch((error) => {
            const response = {
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            };
            if (typeof callback === "function") {
              callback(response);
            }
            return response;
          });

        return promise;
      },
      lastError: null
    },
    bookmarks: listeners
  };

  window.chrome = Object.assign({}, window.chrome, previewChrome);

  async function handleMessage(message) {
    const state = readState();

    switch (message?.type) {
      case "getState":
        return { ok: true, ...buildState(state) };
      case "getActiveTab":
        return { ok: true, tab: state.activeTab ?? null };
      case "setActiveRoot":
        state.activeRootId = String(message.rootId ?? "");
        ensureActiveRoot(state);
        writeState(state);
        return { ok: true, ...buildState(state) };
      case "createRootFolder": {
        const root = createFolderNode(state, BOOKMARK_BAR_ID, String(message.title ?? "").trim());
        state.activeRootId = root.id;
        writeState(state);
        listeners.onCreated.dispatch(root.id, cloneNode(root));
        listeners.onChildrenReordered.dispatch(BOOKMARK_BAR_ID, getChildIds(state, BOOKMARK_BAR_ID));
        return { ok: true, ...buildState(state) };
      }
      case "renameNode": {
        const node = getNode(state, String(message.nodeId ?? ""));
        node.title = String(message.title ?? "").trim() || node.title;
        writeState(state);
        listeners.onChanged.dispatch(node.id, { title: node.title });
        return { ok: true, ...buildState(state) };
      }
      case "deleteNode": {
        deleteNode(state, String(message.nodeId ?? ""));
        ensureActiveRoot(state);
        writeState(state);
        return { ok: true, ...buildState(state) };
      }
      case "createFolder": {
        createFolderNode(state, String(message.parentId ?? ""), String(message.title ?? "").trim());
        writeState(state);
        listeners.onChildrenReordered.dispatch(String(message.parentId ?? ""), getChildIds(state, String(message.parentId ?? "")));
        return { ok: true, ...buildState(state) };
      }
      case "createBookmark": {
        createBookmarkNode(state, {
          parentId: String(message.parentId ?? ""),
          title: String(message.title ?? ""),
          url: String(message.url ?? ""),
          index: typeof message.index === "number" ? message.index : undefined
        });
        writeState(state);
        listeners.onChildrenReordered.dispatch(String(message.parentId ?? ""), getChildIds(state, String(message.parentId ?? "")));
        return { ok: true, ...buildState(state) };
      }
      case "updateBookmark": {
        const node = getNode(state, String(message.nodeId ?? ""));
        if (!node.url) {
          throw new Error("Only bookmarks can be updated.");
        }
        node.title = String(message.title ?? "").trim() || node.title;
        node.url = normalizeUrl(String(message.url ?? ""));
        writeState(state);
        listeners.onChanged.dispatch(node.id, { title: node.title, url: node.url });
        return { ok: true, ...buildState(state) };
      }
      case "moveNode": {
        moveNode(state, {
          nodeId: String(message.nodeId ?? ""),
          parentId: String(message.parentId ?? ""),
          index: typeof message.index === "number" ? message.index : 0
        });
        writeState(state);
        return { ok: true, ...buildState(state) };
      }
      case "openBookmark": {
        const url = normalizeUrl(String(message.url ?? ""));
        window.open(url, "_blank", "noopener");
        return { ok: true };
      }
      default:
        throw new Error("Unknown preview message.");
    }
  }

  function buildState(state) {
    ensureActiveRoot(state);
    const roots = getChildIds(state, BOOKMARK_BAR_ID)
      .map((id) => state.nodes[id])
      .filter((node) => node && !node.url)
      .map((node, index) => mapNode(state, node.id, BOOKMARK_BAR_ID, index));

    const activeRoot = state.activeRootId ? mapNode(state, state.activeRootId) : null;

    return {
      activeRootId: state.activeRootId,
      roots,
      activeRoot
    };
  }

  function mapNode(state, nodeId, parentOverride, indexOverride) {
    const node = getNode(state, nodeId);
    const isFolder = !node.url;
    return {
      id: node.id,
      type: isFolder ? "folder" : "bookmark",
      title: node.title || (isFolder ? "Untitled folder" : node.url || "Untitled bookmark"),
      url: node.url,
      editable: node.id !== BOOKMARK_BAR_ID,
      parentId: parentOverride ?? node.parentId ?? null,
      index: typeof indexOverride === "number" ? indexOverride : getIndexInParent(state, node.id),
      children: isFolder
        ? getChildIds(state, node.id).map((childId, index) => mapNode(state, childId, node.id, index))
        : undefined
    };
  }

  function createFolderNode(state, parentId, title) {
    const trimmed = String(title ?? "").trim();
    if (!trimmed) {
      throw new Error("Folder name is required.");
    }

    const parent = getNode(state, parentId);
    if (parent.url) {
      throw new Error("Folders can only be created inside folders.");
    }

    const node = {
      id: nextId(state),
      title: trimmed,
      parentId,
      children: []
    };

    state.nodes[node.id] = node;
    parent.children.push(node.id);
    listeners.onCreated.dispatch(node.id, cloneNode(node));
    return node;
  }

  function createBookmarkNode(state, { parentId, title, url, index }) {
    const parent = getNode(state, parentId);
    if (parent.url) {
      throw new Error("Bookmarks can only be created inside folders.");
    }

    const normalizedUrl = normalizeUrl(url);
    const node = {
      id: nextId(state),
      title: String(title ?? "").trim() || normalizedUrl,
      url: normalizedUrl,
      parentId
    };

    state.nodes[node.id] = node;

    const insertionIndex =
      typeof index === "number" ? clamp(index, 0, parent.children.length) : parent.children.length;
    parent.children.splice(insertionIndex, 0, node.id);
    listeners.onCreated.dispatch(node.id, cloneNode(node));
    return node;
  }

  function moveNode(state, { nodeId, parentId, index }) {
    const node = getNode(state, nodeId);
    const targetParent = getNode(state, parentId);
    if (targetParent.url) {
      throw new Error("Destination must be a folder.");
    }

    if (!node.url) {
      if (node.id === parentId) {
        throw new Error("Cannot move a folder into itself.");
      }
      if (isDescendant(state, parentId, node.id)) {
        throw new Error("Cannot move a folder into one of its descendants.");
      }
    }

    const sourceParent = getNode(state, node.parentId);
    const sourceIndex = sourceParent.children.indexOf(node.id);
    if (sourceIndex >= 0) {
      sourceParent.children.splice(sourceIndex, 1);
    }

    const boundedIndex = clamp(index, 0, targetParent.children.length);
    const finalIndex =
      sourceParent.id === targetParent.id && boundedIndex > sourceIndex ? boundedIndex - 1 : boundedIndex;

    targetParent.children.splice(finalIndex, 0, node.id);
    node.parentId = targetParent.id;

    listeners.onMoved.dispatch(node.id, {
      parentId: targetParent.id,
      index: finalIndex,
      oldParentId: sourceParent.id,
      oldIndex: sourceIndex
    });
    listeners.onChildrenReordered.dispatch(sourceParent.id, getChildIds(state, sourceParent.id));
    listeners.onChildrenReordered.dispatch(targetParent.id, getChildIds(state, targetParent.id));
  }

  function deleteNode(state, nodeId) {
    const node = getNode(state, nodeId);
    const parentId = node.parentId;
    const parent = parentId ? getNode(state, parentId) : null;
    const removeIds = [];
    collectNodeIds(state, nodeId, removeIds);

    if (parent) {
      parent.children = parent.children.filter((childId) => childId !== nodeId);
      listeners.onChildrenReordered.dispatch(parent.id, getChildIds(state, parent.id));
    }

    for (const id of removeIds) {
      delete state.nodes[id];
      listeners.onRemoved.dispatch(id, { parentId, index: -1, node: { id } });
    }
  }

  function collectNodeIds(state, nodeId, bucket) {
    const node = getNode(state, nodeId);
    bucket.push(node.id);
    if (!node.url) {
      for (const childId of node.children) {
        collectNodeIds(state, childId, bucket);
      }
    }
  }

  function ensureActiveRoot(state) {
    const roots = getChildIds(state, BOOKMARK_BAR_ID)
      .map((id) => state.nodes[id])
      .filter((node) => node && !node.url);

    if (!roots.some((root) => root.id === state.activeRootId)) {
      state.activeRootId = roots[0]?.id ?? null;
    }
  }

  function getNode(state, nodeId) {
    const node = state.nodes[nodeId];
    if (!node) {
      throw new Error("Node not found.");
    }
    return node;
  }

  function getChildIds(state, nodeId) {
    const node = getNode(state, nodeId);
    return Array.isArray(node.children) ? [...node.children] : [];
  }

  function getIndexInParent(state, nodeId) {
    const node = getNode(state, nodeId);
    if (!node.parentId) {
      return 0;
    }
    const parent = getNode(state, node.parentId);
    return parent.children.indexOf(nodeId);
  }

  function isDescendant(state, candidateId, ancestorId) {
    let current = getNode(state, candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) {
        return true;
      }
      current = state.nodes[current.parentId];
    }
    return false;
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (_error) {}
    const seeded = createSeedState();
    writeState(seeded);
    return seeded;
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function createSeedState() {
    return {
      version: 1,
      nextId: 100,
      activeRootId: "10",
      activeTab: {
        title: "Sidebar Favorites Demo",
        url: "https://example.com/sidebar-favorites"
      },
      nodes: {
        "1": { id: "1", title: "Bookmarks bar", children: ["10", "20", "30"] },
        "10": { id: "10", title: "Daily", parentId: "1", children: ["11", "12", "13"] },
        "11": { id: "11", title: "Inbox", parentId: "10", children: ["14", "15"] },
        "12": { id: "12", title: "OpenAI", url: "https://openai.com/", parentId: "10" },
        "13": { id: "13", title: "Reading", parentId: "10", children: ["16"] },
        "14": { id: "14", title: "Docs", url: "https://developer.chrome.com/docs/extensions/", parentId: "11" },
        "15": { id: "15", title: "Figma", url: "https://www.figma.com/", parentId: "11" },
        "16": { id: "16", title: "Design Notes", url: "https://example.com/design-notes", parentId: "13" },
        "20": { id: "20", title: "Research", parentId: "1", children: ["21", "22"] },
        "21": { id: "21", title: "AI Models", url: "https://platform.openai.com/docs/models", parentId: "20" },
        "22": { id: "22", title: "Benchmarks", url: "https://example.com/benchmarks", parentId: "20" },
        "30": { id: "30", title: "Weekend", parentId: "1", children: ["31", "32"] },
        "31": { id: "31", title: "Recipes", url: "https://example.com/recipes", parentId: "30" },
        "32": { id: "32", title: "Trips", parentId: "30", children: ["33"] },
        "33": { id: "33", title: "Flight Watch", url: "https://example.com/flights", parentId: "32" }
      }
    };
  }

  function nextId(state) {
    state.nextId += 1;
    return String(state.nextId);
  }

  function normalizeUrl(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      throw new Error("Please enter a valid URL.");
    }
    try {
      return new URL(trimmed).toString();
    } catch (_error) {
      return new URL(`https://${trimmed}`).toString();
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cloneNode(node) {
    return JSON.parse(JSON.stringify(node));
  }

  function createEvent() {
    const handlers = new Set();
    return {
      addListener(listener) {
        handlers.add(listener);
      },
      removeListener(listener) {
        handlers.delete(listener);
      },
      hasListener(listener) {
        return handlers.has(listener);
      },
      dispatch(...args) {
        for (const handler of handlers) {
          handler(...args);
        }
      }
    };
  }
})();
