@tool
extends Node

class_name GameAgentHarnessClient

const DEFAULT_URL := "ws://127.0.0.1:8765"
const RECONNECT_DELAY_SECONDS := 2.0
const DEFAULT_MAX_FRAME_DIMENSION := 640
const DEFAULT_FRAME_QUALITY := 0.8
const WEBSOCKET_OUTBOUND_BUFFER_SIZE := 8 * 1024 * 1024

var url: String = DEFAULT_URL
var socket := WebSocketPeer.new()
var queue: Array[String] = []
var connected := false
var project_name := ""
var project_root := ""
var _reconnect_timer := 0.0
var _should_reconnect := true
var _LOG_LEVELS := { "debug": 0, "info": 1, "warning": 2, "error": 3, "off": 4 }

func _ready() -> void:
	_log_info("client _ready, url=%s" % url)
	process_mode = Node.PROCESS_MODE_ALWAYS
	project_root = ProjectSettings.globalize_path("res://")
	project_name = _detect_project_name()
	url = ProjectSettings.get_setting("game_agent_harness/intake_url", DEFAULT_URL)
	connect_to_host()

func _process(delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not connected:
			connected = true
			_reconnect_timer = 0.0
			send_event("engine.connected", {})
			send_event("project.opened", {
				"projectName": project_name,
				"projectRoot": project_root
			})
		_flush_queue()
		_receive_messages()
	elif state == WebSocketPeer.STATE_CLOSED:
		connected = false
		if _should_reconnect:
			_reconnect_timer += delta
			if _reconnect_timer >= RECONNECT_DELAY_SECONDS:
				_reconnect_timer = 0.0
				_reconnect()

func connect_to_host() -> void:
	socket.set_outbound_buffer_size(WEBSOCKET_OUTBOUND_BUFFER_SIZE)
	var err := socket.connect_to_url(url)
	if err != OK:
		_log_warning("Could not connect to %s, err=%s" % [url, err])

func stop_reconnecting() -> void:
	_should_reconnect = false

func _reconnect() -> void:
	if socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		return
	socket = WebSocketPeer.new()
	connect_to_host()

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

var _last_frame_hash: int = 0
var _last_frame_hash_count: int = 0

func send_frame(image: Image, source: String = "viewport", persist: bool = false, force: bool = false) -> void:
	if image == null:
		return
	var resized := _resize_image(image)
	var quality: float = float(ProjectSettings.get_setting("game_agent_harness/frame_quality", DEFAULT_FRAME_QUALITY))
	var buffer := resized.save_jpg_to_buffer(quality)
	if buffer.size() == 0:
		return

	var hash := _hash_buffer(buffer)
	if not force and not persist and hash == _last_frame_hash:
		_last_frame_hash_count += 1
		return
	_last_frame_hash = hash
	_last_frame_hash_count = 0

	var message := {
		"kind": "frame",
		"format": "jpeg",
		"data": Marshalls.raw_to_base64(buffer),
		"width": resized.get_width(),
		"height": resized.get_height(),
		"source": source,
		"persist": persist,
		"engine": {
			"name": "godot",
			"version": Engine.get_version_info().get("string", "")
		},
		"project": {
			"name": project_name,
			"root": project_root
		},
		"frame": Engine.get_process_frames(),
		"engineTimeMs": int(Time.get_ticks_msec())
	}
	send_message(message)

func _hash_buffer(buffer: PackedByteArray) -> int:
	var h := 0
	var step := maxi(buffer.size() / 1024, 1)
	var i := 0
	while i < buffer.size():
		h = (h * 31 + buffer[i]) & 0x7FFFFFFF
		i += step
	return h

func _resize_image(image: Image) -> Image:
	var max_dim := max(image.get_width(), image.get_height())
	var limit := int(ProjectSettings.get_setting("game_agent_harness/max_frame_dimension", DEFAULT_MAX_FRAME_DIMENSION))
	if limit <= 0 or max_dim <= limit:
		return image
	var scale: float = float(limit) / float(max_dim)
	var new_width := max(1, int(image.get_width() * scale))
	var new_height := max(1, int(image.get_height() * scale))
	var copy := image.duplicate()
	copy.resize(new_width, new_height, Image.INTERPOLATE_BILINEAR)
	return copy

func send_message(message: Dictionary) -> void:
	var text := JSON.stringify(message)
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(text)
	else:
		queue.append(text)
		if queue.size() > 512:
			queue.pop_front()

func _receive_messages() -> void:
	while socket.get_available_packet_count() > 0:
		var packet := socket.get_packet()
		var text := packet.get_string_from_utf8()
		if text.is_empty():
			continue
		var parsed := JSON.new()
		var err := parsed.parse(text)
		if err == OK:
			_handle_host_message(parsed.data)

func _handle_host_message(message: Variant) -> void:
	if not (message is Dictionary):
		return
	var kind := str(message.get("kind", ""))
	if kind == "host.error":
		_log_warning("host error: %s" % str(message.get("error", "")))
	elif kind == "control":
		_handle_control_message(message)

func _handle_control_message(message: Dictionary) -> void:
	var action := str(message.get("action", ""))
	_log_debug("client received control: %s" % action)
	if action == "runtime_capture":
		_set_capture_enabled("runtime_capture_enabled", bool(message.get("enabled", true)))
	# Let the parent plugin/runtime handle everything else (play, stop, snapshot, etc.)
	var parent := get_parent()
	if parent != null and parent.has_method("_on_harness_control"):
		_log_debug("forwarding control to parent: %s" % parent.name)
		parent._on_harness_control(message)
	else:
		_log_debug("no parent handler for control: %s" % action)

func _set_capture_enabled(key: String, enabled: bool) -> void:
	if not ProjectSettings.has_setting("game_agent_harness/" + key):
		ProjectSettings.set_initial_value("game_agent_harness/" + key, true)
	ProjectSettings.set_setting("game_agent_harness/" + key, enabled)
	ProjectSettings.save()
	var event_type := key.replace("_enabled", ".changed")
	send_event(event_type, { "enabled": enabled })
	_log_warning("%s %s from dashboard" % [key.replace("_enabled", "").capitalize(), "enabled" if enabled else "disabled"])

func _flush_queue() -> void:
	while queue.size() > 0 and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(queue.pop_front())

func _detect_project_name() -> String:
	var configured := str(ProjectSettings.get_setting("application/config/name", ""))
	if configured.strip_edges() != "":
		return configured
	var parts := project_root.trim_suffix("/").split("/")
	return parts[parts.size() - 1] if parts.size() > 0 else "GodotProject"

func _current_log_level() -> String:
	var level := str(ProjectSettings.get_setting("game_agent_harness/log_level", "info"))
	if not _LOG_LEVELS.has(level):
		return "info"
	return level

func _should_log(level: String) -> bool:
	var current := _current_log_level()
	if current == "off":
		return false
	if not _LOG_LEVELS.has(level):
		return true
	return _LOG_LEVELS[level] >= _LOG_LEVELS[current]

func _log(level: String, message: String) -> void:
	if not _should_log(level):
		return
	var prefix := "[GameAgentHarness] %s" % message
	match level:
		"error":
			push_error(prefix)
		"warning":
			push_warning(prefix)
		_:
			print(prefix)

func _log_debug(message: String) -> void:
	_log("debug", message)

func _log_info(message: String) -> void:
	_log("info", message)

func _log_warning(message: String) -> void:
	_log("warning", message)

func _log_error(message: String) -> void:
	_log("error", message)

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
