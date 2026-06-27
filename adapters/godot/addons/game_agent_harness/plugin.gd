@tool
extends EditorPlugin

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")
const DashboardPanelScript := preload("res://addons/game_agent_harness/editor_dashboard_panel.gd")
const RuntimeAutoloadName := "GameAgentHarnessRuntime"
const RuntimeAutoloadPath := "res://addons/game_agent_harness/runtime_recorder.gd"

var client: GameAgentHarnessClient
var editor_selection: EditorSelection
var dashboard_panel: GameAgentHarnessDashboardPanel
var _runtime_running := false
var _log_file: FileAccess = null
var _log_file_path := ""
var _log_poll_timer := 0.0
var _log_poll_interval := 1.0
var _last_log_length := 0
var _editor_viewport_enabled := false
var _editor_viewport_interval := 0.2
var _editor_viewport_timer := 0.0
var _inspector_enabled := true
var _signals_enabled := true
var _history_enabled := true
var _selection_from_dashboard := false
var _preview_requests: Dictionary = {}
var _log_level := "info"
var _scene_tree_cache: Dictionary = {}
var _scene_tree_cache_at := 0.0
var _SCENE_TREE_CACHE_TTL := 1.0
var _LOG_LEVELS := { "debug": 0, "info": 1, "warning": 2, "error": 3, "off": 4 }

func _enter_tree() -> void:
	client = ClientScript.new()
	client.name = "GameAgentHarnessEditorClient"
	add_child(client)

	_inspector_enabled = ProjectSettings.get_setting("game_agent_harness/inspector_enabled", true)
	_signals_enabled = ProjectSettings.get_setting("game_agent_harness/signals_enabled", true)
	_history_enabled = ProjectSettings.get_setting("game_agent_harness/history_enabled", true)

	var stored_level := str(ProjectSettings.get_setting("game_agent_harness/log_level", "info"))
	_log_level = stored_level if _LOG_LEVELS.has(stored_level) else "info"

	add_autoload_singleton(RuntimeAutoloadName, RuntimeAutoloadPath)

	editor_selection = get_editor_interface().get_selection()
	if editor_selection != null:
		editor_selection.selection_changed.connect(_on_selection_changed)

	scene_changed.connect(_on_scene_changed)

	dashboard_panel = DashboardPanelScript.new()
	dashboard_panel.name = "GameAgentHarnessDashboard"
	add_control_to_dock(DOCK_SLOT_LEFT_UL, dashboard_panel)

	add_tool_menu_item("Start Game Agent Harness", _on_tool_menu_start)

	_enable_file_logging()
	_open_log_file()

	client.send_event("plugin.enabled", {})
	_emit_editor_context()
	set_process(true)

func _process(delta: float) -> void:
	_log_poll_timer += delta
	if _log_poll_timer >= _log_poll_interval:
		_log_poll_timer = 0.0
		_tail_log_file()

	if _editor_viewport_enabled:
		_editor_viewport_timer += delta
		if _editor_viewport_timer >= _editor_viewport_interval:
			_editor_viewport_timer = 0.0
			_send_editor_viewport_frame()

	var playing := get_editor_interface().is_playing_scene()
	if playing == _runtime_running:
		_update_dashboard_status()
		return
	_runtime_running = playing
	if playing:
		var edited_root := get_editor_interface().get_edited_scene_root()
		var scene_path := edited_root.scene_file_path if edited_root != null else ""
		client.send_event("runtime.started", {
			"scene": scene_path
		})
		_send_history("engine", "runtime.started", { "scene": scene_path })
	else:
		client.send_event("runtime.stopped", {})
		_send_history("engine", "runtime.stopped", {})
	_update_dashboard_status()

func _exit_tree() -> void:
	remove_tool_menu_item("Start Game Agent Harness")

	if editor_selection != null and editor_selection.selection_changed.is_connected(_on_selection_changed):
		editor_selection.selection_changed.disconnect(_on_selection_changed)

	remove_autoload_singleton(RuntimeAutoloadName)

	if dashboard_panel != null:
		remove_control_from_docks(dashboard_panel)
		dashboard_panel.queue_free()
		dashboard_panel = null

	if client != null:
		client.send_event("plugin.disabled", {})
		client.stop_reconnecting()
		client.queue_free()
		client = null

func _on_tool_menu_start(_ud = null) -> void:
	if dashboard_panel != null:
		dashboard_panel.start_harness()

func _set_log_level(level: String) -> void:
	var normalized := level.to_lower()
	if not _LOG_LEVELS.has(normalized):
		return
	_log_level = normalized
	ProjectSettings.set_setting("game_agent_harness/log_level", _log_level)
	ProjectSettings.save()
	_log_info("log level set to %s" % _log_level)

func _should_log(level: String) -> bool:
	if _log_level == "off":
		return false
	if not _LOG_LEVELS.has(level):
		return true
	return _LOG_LEVELS[level] >= _LOG_LEVELS[_log_level]

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

func _on_harness_control(message: Dictionary) -> void:
	var action := str(message.get("action", ""))
	_log_debug("plugin received control: %s" % action)
	if action == "play":
		get_editor_interface().play_current_scene()
		_send_history("dashboard", "play", {})
	elif action == "stop":
		get_editor_interface().stop_playing_scene()
		_send_history("dashboard", "stop", {})
	elif action == "editor_viewport":
		_editor_viewport_enabled = bool(message.get("enabled", false))
		_editor_viewport_interval = clampf(float(message.get("interval", 0.2)), 0.05, 2.0)
		ProjectSettings.set_setting("game_agent_harness/editor_viewport_enabled", _editor_viewport_enabled)
		ProjectSettings.set_setting("game_agent_harness/editor_viewport_interval", _editor_viewport_interval)
		ProjectSettings.save()
		_send_history("dashboard", "editor_viewport", { "enabled": _editor_viewport_enabled, "interval": _editor_viewport_interval })
	elif action == "runtime_viewport_interval":
		var interval := clampf(float(message.get("interval", 0.2)), 0.05, 2.0)
		ProjectSettings.set_setting("game_agent_harness/runtime_viewport_interval", interval)
		ProjectSettings.save()
		_send_history("dashboard", "runtime_viewport_interval", { "interval": interval })
	elif action == "inspector_config":
		_inspector_enabled = bool(message.get("inspector_enabled", _inspector_enabled))
		_signals_enabled = bool(message.get("signals_enabled", _signals_enabled))
		_history_enabled = bool(message.get("history_enabled", _history_enabled))
		ProjectSettings.set_setting("game_agent_harness/inspector_enabled", _inspector_enabled)
		ProjectSettings.set_setting("game_agent_harness/signals_enabled", _signals_enabled)
		ProjectSettings.set_setting("game_agent_harness/history_enabled", _history_enabled)
		ProjectSettings.save()
		_send_history("dashboard", "inspector_config", { "inspector_enabled": _inspector_enabled, "signals_enabled": _signals_enabled, "history_enabled": _history_enabled })
	elif action == "log.level":
		_set_log_level(str(message.get("level", _log_level)))
	elif action == "scene.open":
		var open_path := str(message.get("path", ""))
		if not open_path.is_empty():
			var res_path := open_path if open_path.begins_with("res://") else "res://" + open_path.replace("\\", "/")
			get_editor_interface().open_scene_from_path(res_path)
			_send_history("dashboard", "scene.open", { "path": open_path })
	elif action == "scene.tree":
		_send_scene_tree()
	elif action == "inspector.query":
		var query_path := str(message.get("path", ""))
		var query_node := get_tree().root.get_node_or_null(NodePath(query_path))
		if query_node != null and query_node is Node:
			client.send_event("inspector.data", _build_inspector_data(query_node), GameAgentHarnessClient.node_entity(query_node))
	elif action == "selection.set":
		var set_path := str(message.get("path", ""))
		var set_node := get_tree().root.get_node_or_null(NodePath(set_path))
		if set_node != null and set_node is Node and editor_selection != null:
			_selection_from_dashboard = true
			editor_selection.clear()
			editor_selection.add_node(set_node)
	elif action == "resource.preview":
		var preview_path := str(message.get("path", ""))
		_send_resource_preview(preview_path)
	elif action == "resource.import_settings":
		var import_path := str(message.get("path", ""))
		_send_resource_import_settings(import_path)
	elif action == "snapshot" or action == "pause" or action == "input.pointer":
		# Forwarded to runtime autoload when available
		var runtime := get_tree().root.get_node_or_null(RuntimeAutoloadName)
		if runtime != null and runtime.has_method("_on_harness_control"):
			runtime._on_harness_control(message)
		_send_history("dashboard", action, message.get("data", {}))

func _on_selection_changed() -> void:
	_log_debug("selection changed, inspector_enabled=%s" % _inspector_enabled)
	if client == null or editor_selection == null:
		return

	var nodes := editor_selection.get_selected_nodes()
	var selected: Array[Dictionary] = []
	for node in nodes:
		selected.append(GameAgentHarnessClient.node_entity(node))

	var primary: Dictionary = selected[0] if selected.size() > 0 else {}
	var source := "sync" if _selection_from_dashboard else "editor"
	_selection_from_dashboard = false
	client.send_event("selection.changed", {
		"count": selected.size(),
		"selected": selected,
		"source": source
	}, primary)

	if _inspector_enabled and nodes.size() > 0:
		var primary_node = nodes[0]
		client.send_event("inspector.data", _build_inspector_data(primary_node), GameAgentHarnessClient.node_entity(primary_node))

func _on_scene_changed(root: Node) -> void:
	var scene_path := ""
	if root != null:
		scene_path = root.scene_file_path
	client.send_event("scene.changed", { "scenePath": scene_path })
	_emit_editor_context()

func _update_dashboard_status() -> void:
	if dashboard_panel == null:
		return
	if dashboard_panel.is_harness_running():
		return
	if client != null and client.connected:
		dashboard_panel.set_status_text("Status: connected to harness")
	else:
		dashboard_panel.set_status_text("Status: disconnected")

func _emit_editor_context() -> void:
	var edited_scene_root := get_editor_interface().get_edited_scene_root()
	var entity := GameAgentHarnessClient.node_entity(edited_scene_root)
	var scene_path := edited_scene_root.scene_file_path if edited_scene_root != null else ""
	client.send_event("editor.context", {
		"editedSceneRoot": entity,
		"scenePath": scene_path
	}, entity)

func _enable_file_logging() -> void:
	var changed := false
	if not ProjectSettings.get_setting("debug/file_logging/enable_file_logging", false):
		ProjectSettings.set_setting("debug/file_logging/enable_file_logging", true)
		changed = true
	if not ProjectSettings.get_setting("debug/file_logging/enable_file_logging_pc", false):
		ProjectSettings.set_setting("debug/file_logging/enable_file_logging_pc", true)
		changed = true
	var log_path := str(ProjectSettings.get_setting("debug/file_logging/log_path", "user://logs/godot.log"))
	if log_path.is_empty():
		log_path = "user://logs/godot.log"
		ProjectSettings.set_setting("debug/file_logging/log_path", log_path)
		changed = true
	_log_file_path = ProjectSettings.globalize_path(log_path)
	if changed:
		ProjectSettings.save()

func _open_log_file() -> void:
	if _log_file_path.is_empty():
		return
	if not FileAccess.file_exists(_log_file_path):
		return
	_log_file = FileAccess.open(_log_file_path, FileAccess.READ)
	if _log_file != null:
		_log_file.seek_end()
		_last_log_length = _log_file.get_length()

func _tail_log_file() -> void:
	if _log_file == null:
		if FileAccess.file_exists(_log_file_path):
			_open_log_file()
		return
	if _log_file.get_error() != OK:
		_log_file = null
		_open_log_file()
		return
	var current_length := _log_file.get_length()
	if current_length == _last_log_length:
		return
	_last_log_length = current_length
	while _log_file.get_position() < current_length:
		var line := _log_file.get_line()
		if line.is_empty():
			continue
		var level := _parse_log_level(line)
		client.send_event("engine.log", {
			"level": level,
			"message": line
		})

func _parse_log_level(line: String) -> String:
	var trimmed := line.strip_edges()
	if trimmed.contains("ERROR:") or trimmed.begins_with("ERROR:"):
		return "error"
	if trimmed.contains("WARNING:") or trimmed.begins_with("WARNING:"):
		return "warning"
	if trimmed.contains("INFO:") or trimmed.begins_with("INFO:"):
		return "info"
	if trimmed.contains("VERBOSE:") or trimmed.begins_with("VERBOSE:"):
		return "verbose"
	return "info"

func _send_editor_viewport_frame() -> void:
	_log_debug("_send_editor_viewport_frame enabled=%s" % _editor_viewport_enabled)
	var image := _capture_editor_viewport()
	if image == null:
		_log_debug("editor viewport capture returned null")
		return
	client.send_frame(image, "editor", false)

func _capture_editor_viewport() -> Image:
	var viewport_2d := get_editor_interface().get_editor_viewport_2d()
	var viewport_3d := get_editor_interface().get_editor_viewport_3d()
	var viewport: SubViewport = null
	if viewport_2d != null:
		viewport = viewport_2d
	elif viewport_3d != null:
		viewport = viewport_3d
	if viewport == null:
		return null
	var texture := viewport.get_texture()
	if texture == null:
		return null
	return texture.get_image()

func _build_inspector_data(node: Node) -> Dictionary:
	var properties: Array[Dictionary] = []
	var signals_list: Array[Dictionary] = []

	var current_group := ""
	for prop in node.get_property_list():
		var usage := int(prop.get("usage", 0))
		if usage & PROPERTY_USAGE_GROUP:
			current_group = str(prop.get("name", ""))
			continue
		if usage & PROPERTY_USAGE_CATEGORY:
			continue
		if not (usage & PROPERTY_USAGE_EDITOR):
			continue
		var name := str(prop.get("name", ""))
		if name == "script":
			continue
		var type := int(prop.get("type", TYPE_NIL))
		var value = node.get(name) if node.has_method("get") else null
		properties.append({
			"name": name,
			"type": type_string(type),
			"value": _to_serializable(value),
			"group": current_group
		})

	if _signals_enabled:
		for sig in node.get_signal_list():
			var sig_name := str(sig.get("name", ""))
			var args: Array[String] = []
			for arg in sig.get("args", []):
				args.append("%s: %s" % [str(arg.get("name", "")), type_string(int(arg.get("type", TYPE_NIL)))])
			signals_list.append({
				"name": sig_name,
				"args": args,
				"connectionCount": node.get_signal_connection_list(sig_name).size()
			})

	return {
		"node": GameAgentHarnessClient.node_entity(node),
		"properties": properties,
		"signals": signals_list
	}

func _to_serializable(value: Variant) -> Variant:
	match typeof(value):
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING, TYPE_NIL:
			return value
		TYPE_ARRAY:
			var out: Array[Variant] = []
			for item in value:
				out.append(_to_serializable(item))
			return out
		TYPE_DICTIONARY:
			var dict: Dictionary = {}
			for key in value.keys():
				dict[key] = _to_serializable(value[key])
			return dict
		_:
			if value is Object and value != null:
				return "%s:%s" % [value.get_class(), value.get("resource_path") if value.has_method("get") else ""]
			return var_to_str(value)

func _send_history(source: String, action: String, data: Dictionary) -> void:
	if not _history_enabled:
		return
	if client == null:
		return
	client.send_event("history.action", {
		"source": source,
		"action": action,
		"data": data
	})

func _send_scene_tree() -> void:
	var root := get_editor_interface().get_edited_scene_root()
	_log_debug("_send_scene_tree root=%s" % (root.name if root != null else "null"))
	if root == null:
		client.send_event("scene.tree", { "root": {} })
		return
	var now := Time.get_ticks_msec() / 1000.0
	var root_path := str(root.get_path())
	if _scene_tree_cache.is_empty() or _scene_tree_cache.get("rootPath") != root_path or now - _scene_tree_cache_at > _SCENE_TREE_CACHE_TTL:
		_scene_tree_cache = {
			"rootPath": root_path,
			"root": _build_scene_tree_node(root)
		}
		_scene_tree_cache_at = now
	client.send_event("scene.tree", { "root": _scene_tree_cache.root })

func _build_scene_tree_node(node: Node) -> Dictionary:
	var entity := GameAgentHarnessClient.node_entity(node)
	var children: Array[Dictionary] = []
	for i in range(node.get_child_count()):
		children.append(_build_scene_tree_node(node.get_child(i)))
	entity["hasChildren"] = children.size() > 0
	entity["children"] = children
	return entity

func _send_resource_preview(path: String) -> void:
	var res_path := "res://" + path.replace("\\", "/")
	if not FileAccess.file_exists(res_path):
		client.send_event("resource.preview", { "path": path, "ok": false, "error": "file not found" })
		return
	var ext := res_path.get_extension().to_lower()
	var image: Image = null
	if ext in ["png", "jpg", "jpeg", "webp"]:
		var texture := load(res_path) as Texture2D
		if texture != null:
			image = texture.get_image()
	elif ext in ["tscn", "tres"]:
		# For scenes/resources we skip preview in MVP; could use EditorResourcePreviewer later
		client.send_event("resource.preview", { "path": path, "ok": false, "error": "preview not implemented for this type" })
		return
	else:
		client.send_event("resource.preview", { "path": path, "ok": false, "error": "unsupported extension" })
		return
	if image == null:
		client.send_event("resource.preview", { "path": path, "ok": false, "error": "could not load image" })
		return
	var resized := _resize_image(image)
	var quality: float = float(ProjectSettings.get_setting("game_agent_harness/frame_quality", 0.8))
	var buffer := resized.save_jpg_to_buffer(quality)
	if buffer.size() == 0:
		client.send_event("resource.preview", { "path": path, "ok": false, "error": "encode failed" })
		return
	client.send_event("resource.preview", {
		"path": path,
		"ok": true,
		"data": Marshalls.raw_to_base64(buffer),
		"width": resized.get_width(),
		"height": resized.get_height()
	})

func _send_resource_import_settings(path: String) -> void:
	var import_path := "res://" + path.replace("\\", "/") + ".import"
	if not FileAccess.file_exists(import_path):
		client.send_event("resource.import_settings", { "path": path, "ok": false, "error": "no .import file" })
		return
	var config := ConfigFile.new()
	var err := config.load(import_path)
	if err != OK:
		client.send_event("resource.import_settings", { "path": path, "ok": false, "error": "load failed: %d" % err })
		return
	var out: Dictionary = {}
	for section in config.get_sections():
		var section_dict: Dictionary = {}
		for key in config.get_section_keys(section):
			section_dict[key] = var_to_str(config.get_value(section, key))
		out[section] = section_dict
	client.send_event("resource.import_settings", { "path": path, "ok": true, "settings": out })

func _resize_image(image: Image) -> Image:
	var max_dim := max(image.get_width(), image.get_height())
	var limit := int(ProjectSettings.get_setting("game_agent_harness/max_frame_dimension", 640))
	if limit <= 0 or max_dim <= limit:
		return image
	var scale: float = float(limit) / float(max_dim)
	var new_width := max(1, int(image.get_width() * scale))
	var new_height := max(1, int(image.get_height() * scale))
	var copy := image.duplicate()
	copy.resize(new_width, new_height, Image.INTERPOLATE_BILINEAR)
	return copy
