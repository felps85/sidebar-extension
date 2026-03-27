const STORAGE_KEY = "sidebarFavoritesUiState";

export async function ensureUiState() {
  const current = await readUiState();
  const normalized = normalizeUiState(current?.[STORAGE_KEY]);

  if (!current?.[STORAGE_KEY] || normalized.activeRootId !== current[STORAGE_KEY].activeRootId) {
    await writeUiState(normalized);
  }

  return normalized;
}

export async function getUiState() {
  return ensureUiState();
}

export async function setActiveRootId(activeRootId) {
  const state = await ensureUiState();
  const nextState = normalizeUiState({
    ...state,
    activeRootId: activeRootId ? String(activeRootId) : null
  });
  await writeUiState(nextState);
  return nextState;
}

function normalizeUiState(value) {
  return {
    activeRootId:
      value && typeof value.activeRootId === "string" && value.activeRootId.trim()
        ? value.activeRootId
        : null
  };
}

function readUiState() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function writeUiState(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
