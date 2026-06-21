import fs from "node:fs";
import path from "node:path";
import { ArtifactStore } from "../core/artifact-store.js";
import { buildSummary } from "../core/summary-builder.js";
import { TraceSession } from "../core/trace-session.js";

export const TEST_FIELD_PROFILE = {
  schemaVersion: 1,
  project: {
    name: "Harness Test Field",
    root: "examples/test-field",
  },
  engine: {
    name: "generic-test-engine",
    version: "0.1",
  },
};

function testFieldTraceId() {
  return `test-field-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export function createTestFieldTrace({ traceDir = "traces", traceId = null } = {}) {
  const store = new ArtifactStore(traceDir);
  const engine = TEST_FIELD_PROFILE.engine;
  const project = TEST_FIELD_PROFILE.project;
  const player = {
    id: "generic:entity:player-1",
    kind: "entity",
    name: "Player",
    type: "PlayerController",
    path: "/world/arena/player-1",
  };
  const enemy = {
    id: "generic:entity:enemy-1",
    kind: "entity",
    name: "TrainingBot",
    type: "EnemyAgent",
    path: "/world/arena/enemy-1",
  };
  const hud = {
    id: "generic:entity:hud",
    kind: "ui",
    name: "HUD",
    type: "HudView",
    path: "/ui/hud",
  };

  const session = new TraceSession(store, {
    traceId: traceId ?? testFieldTraceId(),
    context: {
      source: "test-field",
      engine,
      project,
      firstSeenAt: new Date().toISOString(),
    },
  });

  const send = (type, data = {}, entity = null, frame = null) => session.append({
    kind: "event",
    type,
    source: "test-field",
    engine,
    project,
    frame,
    entity,
    data,
  });

  send("engine.connected", {}, null, 1);
  send("project.opened", { projectName: project.name, projectRoot: project.root }, null, 1);
  send("runtime.started", { scene: "TestArena" }, null, 2);
  send("scene.changed", { scenePath: "test://scenes/TestArena", root: { name: "TestArena" } }, null, 2);
  send("selection.changed", { count: 1, selected: [player] }, player, 3);
  send("entity.spawned", { archetype: "player", hp: 3, maxHp: 3 }, player, 4);
  send("entity.spawned", { archetype: "enemy", hp: 1, maxHp: 1 }, enemy, 5);
  send("input.pointer.pressed", { x: 320, y: 180, buttonIndex: 1 }, player, 6);
  send("combat.damage_applied", { source: enemy.id, target: player.id, amount: 1 }, enemy, 7);
  send("player.hp_changed", { previousHp: 3, hp: 2, maxHp: 3, reason: "training-hit" }, player, 8);
  send("inventory.item_added", { itemId: "debug_key", quantity: 1 }, player, 9);
  send("ui.hud_updated", { field: "hp", text: "2/3" }, hud, 10);
  send("state.sampled", {
    scene: "TestArena",
    player: { hp: 2, maxHp: 3, position: { x: 4, y: 2 } },
    inventory: { debug_key: 1 },
    ui: { hudHpText: "2/3" },
  }, player, 11);

  const evidenceRelativePath = "evidence/frame-0001.txt";
  fs.writeFileSync(
    path.join(session.dir, evidenceRelativePath),
    "Test Field frame 0001: Player selected, HP changed from 3 to 2, HUD shows 2/3.\n",
    "utf8",
  );
  send("evidence.frame.captured", {
    path: evidenceRelativePath,
    description: "Text stand-in for a future screenshot/video frame.",
  }, player, 12);
  send("validation.assertion", {
    name: "player hp and hud stayed synchronized",
    pass: true,
    expected: "2/3",
    actual: "2/3",
  }, hud, 13);
  send("log.info", { message: "Test field scenario completed without errors." }, null, 14);

  session.stop();
  const summary = buildSummary(store, session.traceId);

  return {
    traceId: session.traceId,
    traceDir: store.rootDir,
    summaryPath: path.join(session.dir, "summary.md"),
    evidencePath: path.join(session.dir, evidenceRelativePath),
    summary,
  };
}
