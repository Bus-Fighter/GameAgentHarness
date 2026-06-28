import { launchEditor, killProcess } from "../core/editor-launcher.js";

export class EditorManager {
  constructor({ godotBin, projectRoot, onChange = null } = {}) {
    this.godotBin = godotBin;
    this.projectRoot = projectRoot;
    this.onChange = onChange;
    this.editorProcess = null;
    this.editorSockets = new Set();
    this.active = false;
    this.managed = false;
  }

  get isActive() {
    return this.active;
  }

  get isManaged() {
    return this.managed;
  }

  _setState(active, managed) {
    const changed = this.active !== active || this.managed !== managed;
    this.active = active;
    this.managed = managed;
    if (changed && this.onChange) {
      this.onChange({ active, managed });
    }
  }

  _recompute() {
    const active = this.editorProcess != null || this.editorSockets.size > 0;
    const managed = this.editorProcess != null;
    this._setState(active, managed);
  }

  launch() {
    if (this.active) {
      console.log("[editor-manager] editor already active, ignoring launch");
      return { ok: true, alreadyActive: true };
    }

    console.log("[editor-manager] launching Godot editor");
    try {
      const process = launchEditor({ godotBin: this.godotBin, projectRoot: this.projectRoot });
      this.editorProcess = process;
      this._recompute();

      process.on("exit", () => {
        if (this.editorProcess === process) {
          console.log("[editor-manager] managed editor process exited");
          this.editorProcess = null;
          this._recompute();
        }
      });

      return { ok: true, pid: process.pid };
    } catch (error) {
      this.editorProcess = null;
      this._recompute();
      console.error(`[editor-manager] launch failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  close(sendControl) {
    if (!this.active && !this.editorProcess) {
      return { ok: true, alreadyInactive: true };
    }

    if (this.editorProcess) {
      console.log("[editor-manager] killing managed editor process");
      killProcess(this.editorProcess);
      this.editorProcess = null;
    }

    if (this.editorSockets.size > 0 && sendControl) {
      console.log(`[editor-manager] sending quit to ${this.editorSockets.size} unmanaged editor socket(s)`);
      sendControl({ action: "quit" });
    }

    this._recompute();
    return { ok: true };
  }

  markEditorSocket(socket) {
    if (!this.editorSockets.has(socket)) {
      this.editorSockets.add(socket);
      this._recompute();
    }
  }

  unmarkSocket(socket) {
    if (this.editorSockets.delete(socket)) {
      this._recompute();
    }
  }

  handleLaunchControl(message, sendControl) {
    const enabled = message.enabled !== false;
    if (enabled) {
      return this.launch();
    }
    return this.close(sendControl);
  }
}
