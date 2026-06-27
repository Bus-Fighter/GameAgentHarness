extends Node

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")

const DEFAULT_POINTER_INJECT_MODE := "touch"

var client: GameAgentHarnessClient
var last_scene_path := ""
var sample_timer := 0.0
var sample_interval := 1.0
var frame_timer := 0.0
var last_frame_persisted := false
var _paused := false
var _frame_interval := 0.2
var _signal_subscriptions: Array[Dictionary] = []
var _signal_connected_nodes: Dictionary = {}
var _pointer_inject_mode := DEFAULT_POINTER_INJECT_MODE

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_frame_interval = float(ProjectSettings.get_setting("game_agent_harness/runtime_viewport_interval", 0.2))
	_pointer_inject_mode = str(ProjectSettings.get_setting("game_agent_harness/pointer_inject_mode", DEFAULT_POINTER_INJECT_MODE))
	if _pointer_inject_mode != "mouse" and _pointer_inject_mode != "touch":
		_pointer_inject_mode = DEFAULT_POINTER_INJECT_MODE
	ProjectSettings.set_setting("game_agent_harness/runtime_capture_enabled", true)
	ProjectSettings.save()
	client = ClientScript.new()
	client.name = "GameAgentHarnessRuntimeClient"
	add_child(client)

	if not Engine.is_editor_hint():
		client.send_event("runtime.started", {
			"mainScene": ProjectSettings.get_setting("application/run/main_scene", "")
		}, _current_scene_entity())
		_emit_scene_if_changed(true)

func _exit_tree() -> void:
	if client != null and not Engine.is_editor_hint():
		client.send_event("runtime.stopped", {}, _current_scene_entity())

func _process(delta: float) -> void:
	if Engine.is_editor_hint():
		return

	_emit_scene_if_changed(false)

	sample_timer += delta
	if sample_timer >= sample_interval:
		sample_timer = 0.0
		_emit_state_sample()
		_send_viewport_frame(true)

	frame_timer += delta
	if frame_timer >= _frame_interval:
		frame_timer = 0.0
		_send_viewport_frame(false)

func _input(event: InputEvent) -> void:
	if Engine.is_editor_hint() or client == null:
		return

	if event is InputEventMouseButton and event.pressed:
		client.send_event("input.pointer.pressed", {
			"x": event.position.x,
			"y": event.position.y,
			"buttonIndex": event.button_index
		}, _current_scene_entity())
		_send_viewport_frame(true, true)
	elif event is InputEventScreenTouch and event.pressed:
		client.send_event("input.pointer.pressed", {
			"x": event.position.x,
			"y": event.position.y,
			"index": event.index
		}, _current_scene_entity())
		_send_viewport_frame(true, true)
	elif event is InputEventKey and event.pressed:
		client.send_event("input.action.pressed", {
			"keycode": event.keycode,
			"physicalKeycode": event.physical_keycode
		}, _current_scene_entity())

func _emit_scene_if_changed(force: bool) -> void:
	var scene := get_tree().current_scene
	var path := ""
	if scene != null and scene.scene_file_path != "":
		path = scene.scene_file_path
	elif scene != null:
		path = str(scene.get_path())

	if force or path != last_scene_path:
		last_scene_path = path
		client.send_event("scene.changed", {
			"scenePath": path,
			"root": _current_scene_entity()
		}, _current_scene_entity())
		_send_viewport_frame(true, true)
		_scan_scene_for_subscriptions()

func _emit_state_sample() -> void:
	var root := get_tree().root
	var scene := get_tree().current_scene
	var scene_path := ""
	if scene != null and scene.scene_file_path != "":
		scene_path = scene.scene_file_path
	elif scene != null:
		scene_path = str(scene.get_path())

	client.send_event("state.sampled", {
		"scene": scene_path,
		"sceneEntity": _current_scene_entity(),
		"rootChildCount": root.get_child_count() if root != null else 0,
		"currentSceneChildCount": scene.get_child_count() if scene != null else 0
	}, _current_scene_entity())

func _send_viewport_frame(persist: bool, force: bool = false) -> void:
	if client == null:
		return
	if not ProjectSettings.get_setting("game_agent_harness/runtime_capture_enabled", true):
		return
	var image := _capture_viewport()
	if image == null:
		return
	client.send_frame(image, "runtime", persist, force)

func _capture_viewport() -> Image:
	var tree := get_tree()
	if tree == null:
		return null
	var viewport := tree.root
	if viewport == null:
		return null
	var texture := viewport.get_texture()
	if texture == null:
		return null
	return texture.get_image()

func _current_scene_entity() -> Dictionary:
	var scene := get_tree().current_scene if get_tree() != null else null
	return GameAgentHarnessClient.node_entity(scene)

func _on_harness_control(message: Dictionary) -> void:
	var action := str(message.get("action", ""))
	if action == "snapshot":
		_take_snapshot()
	elif action == "pause":
		_set_paused(bool(message.get("enabled", true)))
	elif action == "input.pointer":
		_inject_pointer_input(
			str(message.get("phase", "pressed")),
			float(message.get("x", 0.0)),
			float(message.get("y", 0.0)),
			int(message.get("button", 0))
		)
	elif action == "pointer_inject_mode":
		_set_pointer_inject_mode(str(message.get("mode", DEFAULT_POINTER_INJECT_MODE)))
	elif action == "runtime_capture":
		var enabled := bool(message.get("enabled", true))
		if not ProjectSettings.has_setting("game_agent_harness/runtime_capture_enabled"):
			ProjectSettings.set_initial_value("game_agent_harness/runtime_capture_enabled", true)
		ProjectSettings.set_setting("game_agent_harness/runtime_capture_enabled", enabled)
		ProjectSettings.save()
		_log_info("runtime capture %s from dashboard" % ("enabled" if enabled else "disabled"))
	elif action == "runtime_viewport_interval":
		_frame_interval = clampf(float(message.get("interval", 0.2)), 0.05, 2.0)
		ProjectSettings.set_setting("game_agent_harness/runtime_viewport_interval", _frame_interval)
		ProjectSettings.save()
		_log_info("runtime viewport interval set to %.2fs from dashboard" % _frame_interval)
	elif action == "signal.subscribe":
		_signal_subscriptions.append({
			"match": message.get("match", {}),
			"signal": str(message.get("signal", "")),
			"eventType": str(message.get("eventType", "")),
			"argMapping": message.get("argMapping", []) as Array
		})
		_log_info("subscribed to signal %s -> %s" % [str(message.get("signal", "")), str(message.get("eventType", ""))])
		_scan_scene_for_subscriptions()

func _log_info(message: String) -> void:
	print("[GameAgentHarness] %s" % message)
func _take_snapshot() -> void:
	if client == null:
		return
	var image := _capture_viewport()
	if image == null:
		push_warning("[GameAgentHarness] snapshot failed: could not capture viewport")
		return
	client.send_frame(image, "runtime", true, true)
	client.send_event("snapshot.taken", {
		"width": image.get_width(),
		"height": image.get_height()
	}, _current_scene_entity())

func _set_paused(enabled: bool) -> void:
	if _paused == enabled:
		return
	_paused = enabled
	Engine.time_scale = 0.0 if enabled else 1.0
	if client != null:
		client.send_event("pause.changed", { "enabled": enabled }, _current_scene_entity())
	push_warning("[GameAgentHarness] runtime %s from dashboard" % ("paused" if enabled else "resumed"))

func _inject_pointer_input(phase: String, nx: float, ny: float, button_index: int) -> void:
	var viewport := get_viewport()
	if viewport == null:
		return
	var size := viewport.get_visible_rect().size
	var pos := Vector2(nx * size.x, ny * size.y)

	var event: InputEvent
	if _pointer_inject_mode == "touch":
		var touch := InputEventScreenTouch.new()
		touch.position = pos
		touch.pressed = phase != "released"
		touch.index = button_index
		event = touch
	else:
		var mouse := InputEventMouseButton.new()
		mouse.position = pos
		mouse.button_index = clampi(button_index, 1, 9)
		mouse.pressed = phase != "released"
		event = mouse

	Input.parse_input_event(event)

func _set_pointer_inject_mode(mode: String) -> void:
	var normalized := mode.to_lower()
	if normalized != "touch" and normalized != "mouse":
		normalized = DEFAULT_POINTER_INJECT_MODE
	_pointer_inject_mode = normalized
	if not ProjectSettings.has_setting("game_agent_harness/pointer_inject_mode"):
		ProjectSettings.set_initial_value("game_agent_harness/pointer_inject_mode", DEFAULT_POINTER_INJECT_MODE)
	ProjectSettings.set_setting("game_agent_harness/pointer_inject_mode", _pointer_inject_mode)
	ProjectSettings.save()
	_log_info("pointer inject mode set to %s from dashboard" % _pointer_inject_mode)

func _scan_scene_for_subscriptions() -> void:
	var root := get_tree().root if get_tree() != null else null
	if root == null:
		return
	_scan_node_for_subscriptions(root)

func _scan_node_for_subscriptions(node: Node) -> void:
	if node == null:
		return
	for sub in _signal_subscriptions:
		if _node_matches_subscription(node, sub.match):
			_connect_signal_subscription(node, sub)
	for child in node.get_children():
		_scan_node_for_subscriptions(child)

func _node_matches_subscription(node: Node, match_rules: Dictionary) -> bool:
	if match_rules.is_empty():
		return false
	if match_rules.has("nodeClass"):
		var node_class_name := str(match_rules.get("nodeClass", ""))
		if node.get_class() != node_class_name and not node.is_class(node_class_name):
			return false
	if match_rules.has("nodeName"):
		if node.name != str(match_rules.get("nodeName", "")):
			return false
	if match_rules.has("nodePath"):
		if not _path_matches_pattern(str(node.get_path()), str(match_rules.get("nodePath", ""))):
			return false
	return true

func _path_matches_pattern(path: String, pattern: String) -> bool:
	var path_parts := path.trim_prefix("/").split("/", false)
	var pattern_parts := pattern.trim_prefix("/").split("/", false)
	var pi := 0
	var pj := 0
	while pi < path_parts.size() and pj < pattern_parts.size():
		var pp := pattern_parts[pj]
		if pp == "**":
			pj += 1
			if pj >= pattern_parts.size():
				return true
			while pi < path_parts.size() and path_parts[pi] != pattern_parts[pj]:
				pi += 1
			if pi >= path_parts.size():
				return false
		elif pp == "*":
			pi += 1
			pj += 1
		else:
			if path_parts[pi] != pp:
				return false
			pi += 1
			pj += 1
	while pj < pattern_parts.size() and pattern_parts[pj] == "**":
		pj += 1
	return pi >= path_parts.size() and pj >= pattern_parts.size()

func _connect_signal_subscription(node: Node, sub: Dictionary) -> void:
	var sig_name := str(sub.get("signal", ""))
	if sig_name.is_empty():
		return
	var key := "%s:%s" % [str(node.get_path()), sig_name]
	if _signal_connected_nodes.has(key):
		return
	if not node.has_signal(sig_name):
		return
	var callable := Callable(self, "_on_subscribed_signal").bind(node, sub)
	node.connect(sig_name, callable)
	_signal_connected_nodes[key] = true

func _on_subscribed_signal(node: Node, sub: Dictionary, arg0: Variant = null, arg1: Variant = null, arg2: Variant = null, arg3: Variant = null, arg4: Variant = null, arg5: Variant = null) -> void:
	if client == null:
		return
	var args := [arg0, arg1, arg2, arg3, arg4, arg5]
	var mapping := sub.get("argMapping", []) as Array
	var data := {}
	for i in range(min(args.size(), mapping.size())):
		var arg: Variant = args[i]
		var mapped: Variant = mapping[i]
		if mapped is String:
			data[mapped] = _variant_to_json(arg)
		elif mapped is Dictionary and mapped.has("name"):
			data[str(mapped.get("name", ""))] = _variant_to_json(arg)
		else:
			data[str(mapped)] = _variant_to_json(arg)
	client.send_event(str(sub.get("eventType", "")), data, GameAgentHarnessClient.node_entity(node))

func _variant_to_json(value: Variant) -> Variant:
	match typeof(value):
		TYPE_VECTOR2I:
			return { "x": value.x, "y": value.y }
		TYPE_VECTOR2:
			return { "x": value.x, "y": value.y }
		TYPE_VECTOR3:
			return { "x": value.x, "y": value.y, "z": value.z }
		TYPE_RECT2:
			return { "position": { "x": value.position.x, "y": value.position.y }, "size": { "x": value.size.x, "y": value.size.y } }
		TYPE_COLOR:
			return { "r": value.r, "g": value.g, "b": value.b, "a": value.a }
		TYPE_OBJECT:
			if value is Node:
				return GameAgentHarnessClient.node_entity(value as Node)
			return str(value)
		_:
			return value
