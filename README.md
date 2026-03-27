# Sidebar Favorites

Sidebar Favorites is a plain Chrome Manifest V3 side-panel extension for browsing and managing bookmark bar folders in a cleaner dark sidebar UI.

This project is not a parked-tab manager, not a live-tab sidebar, and not a drag-to-trash tab workflow. It is a bookmark and favorites manager built around Chrome bookmarks.

## What the sidebar can do

- Switch between top-level bookmark-bar folders
- Rename or delete the selected top-level folder
- Create a new top-level folder directly in the bookmark bar
- Create subfolders in the active root or inside nested folders
- Add bookmarks using the current page as the default title and URL
- Edit bookmark title and URL
- Delete bookmarks
- Delete folders
- Drag bookmarks and folders into folders
- Prevent moving folders into themselves or their descendants
- Reorder bookmarks by dropping before or after another bookmark row
- Drop raw URLs into the panel to create bookmarks
- Navigate the active tab to a clicked bookmark when possible
- Persist folder collapse state locally in the panel UI

## Load in Chrome

1. Open [chrome://extensions](chrome://extensions)
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `/Users/eldorado/Documents/Codex/sidebar-extension`

The toolbar action opens the side panel. Chrome controls whether the side panel appears on the left or right side.

## Preview mode

Open [preview.html](/Users/eldorado/Documents/Codex/sidebar-extension/preview.html) in a normal browser tab to try the UI with mocked Chrome APIs and seeded sample data.

`preview.html` is only a simulation. It does not modify your real Chrome bookmarks.
