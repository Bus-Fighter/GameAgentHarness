extends Node

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")

var client: GameAgentHarnessClient
var last_scene_path := ""
var sample_timer := 0.0
var sample_interval := 1.0
var frame_timer := 0.0
var last_frame_persisted := false
var _paused := false
var _frame_interval := 0.2

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_frame_interval = float(ProjectSettings.get_setting("game_agent_harness/runtime_viewport_interval", 0.2))
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
	if DisplayServer.is_touchscreen_available():
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
