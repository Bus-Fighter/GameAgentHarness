import test from "node:test";
import assert from "node:assert/strict";
import { EditorManager } from "../src/host/editor-manager.js";

test("EditorManager starts inactive and unmanaged", () => {
  const manager = new EditorManager({});
  assert.equal(manager.isActive, false);
  assert.equal(manager.isManaged, false);
});

test("markEditorSocket makes editor active and unmanaged", () => {
  const manager = new EditorManager({});
  const socket = {};
  manager.markEditorSocket(socket);
  assert.equal(manager.isActive, true);
  assert.equal(manager.isManaged, false);
});

test("unmarkSocket makes editor inactive", () => {
  const manager = new EditorManager({});
  const socket = {};
  manager.markEditorSocket(socket);
  manager.unmarkSocket(socket);
  assert.equal(manager.isActive, false);
  assert.equal(manager.isManaged, false);
});

test("close sends quit to unmanaged editor sockets and stays active until disconnect", () => {
  const manager = new EditorManager({});
  const socket = {};
  manager.markEditorSocket(socket);

  const controls = [];
  const sendControl = (msg) => controls.push(msg);

  const result = manager.close(sendControl);
  assert.equal(result.ok, true);
  assert.deepEqual(controls, [{ action: "quit" }]);
  assert.equal(manager.isActive, true);

  manager.unmarkSocket(socket);
  assert.equal(manager.isActive, false);
});

test("close does nothing when already inactive", () => {
  const manager = new EditorManager({});
  const controls = [];
  const result = manager.close((msg) => controls.push(msg));
  assert.equal(result.ok, true);
  assert.equal(result.alreadyInactive, true);
  assert.equal(controls.length, 0);
});

test("handleLaunchControl with enabled false closes active editor and stays active until disconnect", () => {
  const manager = new EditorManager({});
  const socket = {};
  manager.markEditorSocket(socket);

  const controls = [];
  const result = manager.handleLaunchControl({ enabled: false }, (msg) => controls.push(msg));
  assert.equal(result.ok, true);
  assert.deepEqual(controls, [{ action: "quit" }]);
  assert.equal(manager.isActive, true);

  manager.unmarkSocket(socket);
  assert.equal(manager.isActive, false);
});

test("onChange fires when state changes", () => {
  const changes = [];
  const manager = new EditorManager({
    onChange: (state) => changes.push(state),
  });
  const socket = {};
  manager.markEditorSocket(socket);
  manager.unmarkSocket(socket);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { active: true, managed: false });
  assert.deepEqual(changes[1], { active: false, managed: false });
});
