import { sendWebSocketMessages } from "./ws-client.js";

export async function emitSample({ host = "127.0.0.1", port = 8765 } = {}) {
  const project = {
    name: "CatSweeper",
    root: "/Users/yuenlamfelix/Documents/CS/Godot/CatSweeper",
  };
  const engine = { name: "godot", version: "4.5" };
  const entity = {
    id: "godot:node:/root/Stage/StageController",
    kind: "node",
    name: "StageController",
    path: "/root/Stage/StageController",
  };

  await sendWebSocketMessages({ host, port }, [
    { kind: "event", type: "engine.connected", source: "sample", engine, project, data: {} },
    { kind: "event", type: "runtime.started", source: "sample", engine, project, data: { scene: "Stage_Farm" } },
    { kind: "event", type: "input.pointer.pressed", source: "sample", engine, project, frame: 12, entity, data: { x: 812, y: 443 } },
    { kind: "event", type: "game.reveal.result", source: "sample", engine, project, frame: 13, entity, data: { gridX: 4, gridY: 7, result: "HitMine", mineLevel: 2 } },
    { kind: "event", type: "state.sampled", source: "sample", engine, project, frame: 14, entity, data: { hp: 2, level: 1, exp: 0 } },
    { kind: "event", type: "validation.assertion", source: "sample", engine, project, data: { name: "hp decreased after failed catch", pass: true } },
    { kind: "control", action: "trace.stop" },
  ]);
}
