extends Node

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")

var client: GameAgentHarnessClient
var last_scene_path := ""
var sample_timer := 0.0
var sample_interval := 1.0
var frame_interval := 0.2
var frame_timer := 0.0
var last_frame_persisted := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
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
	if frame_timer >= frame_interval:
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
		_send_viewport_frame(true)
	elif event is InputEventScreenTouch and event.pressed:
		client.send_event("input.pointer.pressed", {
			"x": event.position.x,
			"y": event.position.y,
			"index": event.index
		}, _current_scene_entity())
		_send_viewport_frame(true)
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
		_send_viewport_frame(true)

func _emit_state_sample() -> void:
	var root := get_tree().root
	var scene := get_tree().current_scene
	client.send_event("state.sampled", {
		"scene": _current_scene_entity(),
		"rootChildCount": root.get_child_count() if root != null else 0,
		"currentSceneChildCount": scene.get_child_count() if scene != null else 0
	}, _current_scene_entity())

func _send_viewport_frame(persist: bool) -> void:
	if client == null:
		return
	if not ProjectSettings.get_setting("game_agent_harness/runtime_capture_enabled", true):
		return
	var image := _capture_viewport()
	if image == null:
		return
	client.send_frame(image, "runtime", persist)

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
