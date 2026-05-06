## 📄 `TUI_IMPLEMENTATION.md`

### **Objective**
Refactor the current `InputHandler` and `Logger` to use a Terminal User Interface (TUI) with three distinct panes:
1.  **Log Pane:** A scrollable area for all bot activity.
2.  **Status Pane:** A sidebar showing the current `BotMode` and coordinates.
3.  **Input Pane:** A fixed-position textbox at the bottom for commands.

### **Dependencies**
Install the following libraries:
```bash
bun add blessed
bun add -d @types/blessed
```

### **Architectural Changes**

#### **1. Logger Refactor (`src/Logger.ts`)**
* Remove direct `console.log/warn/error` calls.
* The `Logger` class should emit log strings to a centralized UI manager or a global reference (`global.logPane`).
* Ensure the timestamp and prefix logic are preserved.

#### **2. UI Manager (New File: `src/UIManager.ts`)**
* **Initialization:** Set up a `blessed.screen` with a grid layout.
* **Components:**
    * `logBox`: `blessed.log` (width: 70%, height: 90%).
    * `statusBox`: `blessed.box` (width: 30%, height: 90%, right-aligned).
    * `inputField`: `blessed.textbox` (width: 100%, height: 3, bottom: 0).
* **Integration:**
    * Route `inputField.on('submit')` values directly to the `InputHandler.handleLine()` method.
    * Expose a `updateStatus(mode: string, pos: Vec3)` method to refresh the sidebar.

#### **3. ModeController Integration (`src/modes/ModeController.ts`)**
* Update the `switchTo` and `stop` methods to trigger a UI status refresh so the user sees the mode change instantly.

#### **4. InputHandler Update (`src/InputHandler.ts`)**
* Remove the `readline` interface.
* Link the class to the new TUI `inputField`.
* Ensure the command dispatch logic (auto, stop, exit, coordinates) remains intact.

### **Constraints**
* Maintain the **Strategy Pattern** for modes.
* Keep **explicit return types** and **no-else** constraints as defined in `CLAUDE.md`.
* Ensure the `bot.on('end')` event properly destroys the `blessed` screen to return the terminal to a normal state.
