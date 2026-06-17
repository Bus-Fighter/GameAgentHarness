@tool
extends Node

class_name GameAgentHarnessClient

const DEFAULT_URL := "ws://127.0.0.1:8765"

var url: String = DEFAULT_URL
var socket := WebSocketPeer.new()
var queue: Array[String] = []
var connected := false
var project_name := ""
var project_root := ""

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	project_root = ProjectSettings.globalize_path("res://")
	project_name = _detect_project_name()
	connect_to_host()

func _process(_delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not connected:
			connected = true
			send_event("engine.connected", {})
			send_event("project.opened", {
				"projectName": project_name,
				"projectRoot": project_root
			})
		_flush_queue()
	elif state == WebSocketPeer.STATE_CLOSED:
		connected = false

func connect_to_host() -> void:
	var err := socket.connect_to_url(url)
	if err != OK:
		push_warning("[GameAgentHarness] Could not connect to %s, err=%s" % [url, err])

func send_event(event_type: String, data: Dictionary = {}, entity: Dictionary = {}) -> void:
	var message := {
		"kind": "event",
		"type": event_type,
		"source": "godot",
		"engine": {
			"name": "godot",
			"version": Engine.get_version_info().get("string", "")
		},
		"project": {
			"name": project_name,
			"root": project_root
		},
		"frame": Engine.get_process_frames(),
		"engineTimeMs": int(Time.get_ticks_msec()),
		"entity": entity,
		"data": data
	}
	send_message(message)

func send_message(message: Dictionary) -> void:
	var text := JSON.stringify(message)
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(text)
	else:
		queue.append(text)
		if queue.size() > 512:
			queue.pop_front()

func _flush_queue() -> void:
	while queue.size() > 0 and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(queue.pop_front())

func _detect_project_name() -> String:
	var configured := str(ProjectSettings.get_setting("application/config/name", ""))
	if configured.strip_edges() != "":
		return configured
	var parts := project_root.trim_suffix("/").split("/")
	return parts[parts.size() - 1] if parts.size() > 0 else "GodotProject"

static func node_entity(node: Node) -> Dictionary:
	if node == null:
		return {}
	return {
		"id": "godot:node:%s" % str(node.get_path()),
		"kind": "node",
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path())
	}
