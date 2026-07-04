@tool
extends EditorPlugin

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")
const DashboardPanelScript := preload("res://addons/game_agent_harness/editor_dashboard_panel.gd")
const RuntimeAutoloadName := "GameAgentHarnessRuntime"
const RuntimeAutoloadPath := "res://addons/game_agent_harness/runtime_recorder.gd"
const SETTINGS_SAVE_DEBOUNCE := 1.0

const DOCK_DEFINITIONS := [
	{ "id": "filesystem", "title": "FileSystem", "classes": ["FileSystemDock"] },
	{ "id": "scene", "title": "Scene", "classes": ["SceneTreeDock"] },
	{ "id": "inspector", "title": "Inspector", "classes": ["InspectorDock"] },
	{ "id": "import", "title": "Import", "classes": ["ImportDock"] },
	{ "id": "node", "title": "Node", "classes": ["NodeDock"] },
	{ "id": "history", "title": "History", "classes": ["HistoryDock", "EditorHistoryDock"] },
]

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
var _settings_dirty := false
var _settings_save_timer := 0.0
var _client_reported := false
var _dock_streams: Dictionary = {}
var _dock_max_streams := 4
var _dock_root_image: Image = null
var _dock_root_dirty := false

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

	_report_editor_identity()
	_client_reported = client.connected if client != null else false
	set_process(true)

func _process(delta: float) -> void:
	if client != null and client.connected and not _client_reported:
		_report_editor_identity()
		_client_reported = true
	elif client != null and not client.connected:
		_client_reported = false

	if _settings_dirty:
		_settings_save_timer += delta
		if _settings_save_timer >= SETTINGS_SAVE_DEBOUNCE:
			_settings_dirty = false
			_settings_save_timer = 0.0
			ProjectSettings.save()

	_log_poll_timer += delta
	if _log_poll_timer >= _log_poll_interval:
		_log_poll_timer = 0.0
		_tail_log_file()

	if _editor_viewport_enabled:
		_editor_viewport_timer += delta
		if _editor_viewport_timer >= _editor_viewport_interval:
			_editor_viewport_timer = 0.0
			_send_editor_viewport_frame()

	_process_dock_streams(delta)

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
	_save_project_settings()
	_log_info("log level set to %s" % _log_level)

func _save_project_settings() -> void:
	_settings_dirty = true
	_settings_save_timer = 0.0

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

func _send_engine_log(level: String, message: String) -> void:
	if client != null:
		client.send_event("engine.log", { "level": level, "message": message })

func _send_engine_error(message: String) -> void:
	_send_engine_log("error", message)
	_log_error(message)

func _on_harness_control(message: Dictionary) -> void:
	var action := str(message.get("action", ""))
	_log_debug("plugin received control: %s" % action)
	if action == "play":
		var edited_root := get_editor_interface().get_edited_scene_root()
		if edited_root == null:
			_send_engine_error("Cannot play: no scene is currently open in the editor.")
			return
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
		_save_project_settings()
		_send_history("dashboard", "editor_viewport", { "enabled": _editor_viewport_enabled, "interval": _editor_viewport_interval })
	elif action == "runtime_viewport_interval":
		var interval := clampf(float(message.get("interval", 0.2)), 0.05, 2.0)
		ProjectSettings.set_setting("game_agent_harness/runtime_viewport_interval", interval)
		_save_project_settings()
		var runtime := get_tree().root.get_node_or_null(RuntimeAutoloadName)
		if runtime != null and runtime.has_method("_set_frame_interval"):
			runtime._set_frame_interval(interval)
		_send_history("dashboard", "runtime_viewport_interval", { "interval": interval })
	elif action == "evidence_frame_interval":
		var interval := clampf(float(message.get("interval", 5.0)), 0.5, 60.0)
		ProjectSettings.set_setting("game_agent_harness/evidence_frame_interval", interval)
		_save_project_settings()
		var runtime := get_tree().root.get_node_or_null(RuntimeAutoloadName)
		if runtime != null and runtime.has_method("_set_evidence_interval"):
			runtime._set_evidence_interval(interval)
		_send_history("dashboard", "evidence_frame_interval", { "interval": interval })
	elif action == "inspector_config":
		_inspector_enabled = bool(message.get("inspector_enabled", _inspector_enabled))
		_signals_enabled = bool(message.get("signals_enabled", _signals_enabled))
		_history_enabled = bool(message.get("history_enabled", _history_enabled))
		ProjectSettings.set_setting("game_agent_harness/inspector_enabled", _inspector_enabled)
		ProjectSettings.set_setting("game_agent_harness/signals_enabled", _signals_enabled)
		ProjectSettings.set_setting("game_agent_harness/history_enabled", _history_enabled)
		_save_project_settings()
		_send_history("dashboard", "inspector_config", { "inspector_enabled": _inspector_enabled, "signals_enabled": _signals_enabled, "history_enabled": _history_enabled })
	elif action == "log.level":
		_set_log_level(str(message.get("level", _log_level)))
	elif action == "scene.open":
		var open_path := str(message.get("path", ""))
		if open_path.is_empty():
			_send_engine_error("Cannot open scene: path is empty.")
			return
		var res_path := open_path if open_path.begins_with("res://") else "res://" + open_path.replace("\\", "/")
		if not FileAccess.file_exists(res_path):
			_send_engine_error("Cannot open scene: file not found: %s" % res_path)
			return
		get_editor_interface().open_scene_from_path(res_path)
		_send_history("dashboard", "scene.open", { "path": open_path })
	elif action == "quit":
		get_tree().quit()
		_send_history("dashboard", "quit", {})
	elif action == "fs.refresh":
		var fs := get_editor_interface().get_resource_filesystem()
		if fs != null:
			fs.scan()
		_send_history("dashboard", "fs.refresh", { "path": str(message.get("path", "")) })
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
	elif action == "dock_stream":
		var dock_id := str(message.get("dock", ""))
		if dock_id.is_empty():
			return
		var enabled := bool(message.get("enabled", false))
		var interval := clampf(float(message.get("interval", 0.5)), 0.05, 2.0)
		var tab := str(message.get("tab", ""))
		if not _dock_streams.has(dock_id):
			_dock_streams[dock_id] = { "enabled": false, "interval": 0.5, "timer": 0.0, "tab": "" }
		var s: Dictionary = _dock_streams[dock_id]
		s.enabled = enabled
		s.interval = interval
		s.tab = tab
		if enabled:
			s.timer = 0.0
		_send_history("dashboard", "dock_stream", { "dock": dock_id, "enabled": enabled, "interval": interval, "tab": tab })
	elif action == "docks.refresh":
		_send_dock_list()
	elif action == "input.editor_pointer":
		_forward_editor_pointer(message)
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

func _report_editor_identity() -> void:
	if client == null:
		return
	client.send_event("plugin.enabled", {})
	_emit_editor_context()
	_send_dock_list()

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
	_log_file_path = _resolve_log_path(log_path)
	if changed:
		ProjectSettings.save()

func _resolve_log_path(log_path: String) -> String:
	if log_path.begins_with("user://"):
		var user_dir := OS.get_user_data_dir()
		var relative := log_path.trim_prefix("user://")
		return user_dir.path_join(relative).simplify_path()
	return ProjectSettings.globalize_path(log_path).simplify_path()

func _open_log_file() -> void:
	if _log_file_path.is_empty():
		return
	var dir := _log_file_path.get_base_dir()
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)
	if not FileAccess.file_exists(_log_file_path):
		return
	_log_file = FileAccess.open(_log_file_path, FileAccess.READ)
	if _log_file != null:
		_log_file.seek_end()
		_last_log_length = _log_file.get_length()

func _tail_log_file() -> void:
	if _log_file == null:
		_open_log_file()
		return
	if _log_file.get_error() != OK:
		_log_file = null
		_open_log_file()
		return
	var current_length := _log_file.get_length()
	if current_length < _last_log_length:
		_log_file = null
		_open_log_file()
		return
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

func _process_dock_streams(delta: float) -> void:
	var due_ids: Array[String] = []
	for id in _dock_streams:
		var s: Dictionary = _dock_streams[id]
		if not s.enabled:
			continue
		s.timer += delta
		if s.timer >= s.interval:
			s.timer = 0.0
			due_ids.append(id)
	if due_ids.is_empty():
		return
	var enabled_count := 0
	for id in _dock_streams:
		if _dock_streams[id].enabled:
			enabled_count += 1
	if enabled_count > _dock_max_streams:
		_log_warning("too many dock streams enabled (%d > %d); extra docks will be skipped" % [enabled_count, _dock_max_streams])
	var full := _capture_editor_root()
	if full == null:
		_log_debug("dock stream capture: editor root viewport is null")
		return
	for id in due_ids:
		var s: Dictionary = _dock_streams[id]
		var dock := _resolve_dock(id)
		if dock == null:
			_log_debug("dock stream capture: dock %s not found" % id)
			continue
		if not _ensure_dock_visible(dock, s.get("tab", "")):
			_log_debug("dock stream capture: dock %s is not visible" % id)
			continue
		var cropped := _crop_dock(full, dock)
		if cropped == null:
			_log_debug("dock stream capture: crop failed for dock %s" % id)
			continue
		client.send_frame(cropped, "dock:%s" % id, false, false, _dock_max_dimension(), _dock_quality())

func _dock_max_dimension() -> int:
	return int(ProjectSettings.get_setting("game_agent_harness/dock_max_frame_dimension", 320))

func _dock_quality() -> float:
	return float(ProjectSettings.get_setting("game_agent_harness/dock_frame_quality", 0.5))

func _resolve_dock(id: String) -> Control:
	for def in DOCK_DEFINITIONS:
		if def.id != id:
			continue
		var ei := get_editor_interface()
		# Try known public getters first.
		match id:
			"filesystem":
				var dock = ei.get_file_system_dock()
				if dock != null and dock is Control:
					return dock as Control
			"inspector":
				if ei.has_method("get_inspector_dock"):
					var dock = ei.call("get_inspector_dock")
					if dock != null and dock is Control:
						return dock as Control
		# Fall back to class-name search inside the editor base control.
		var base := ei.get_base_control()
		if base == null:
			return null
		for cls_name in def.classes:
			var found := base.find_children("*", cls_name, true, false)
			if found.size() > 0 and found[0] is Control:
				return found[0] as Control
	return null

func _ensure_dock_visible(dock: Control, tab_title: String = "") -> bool:
	if not dock.visible:
		# Walk up to a TabContainer and switch to this dock's tab.
		var node := dock.get_parent()
		while node != null:
			if node is TabContainer:
				var tc := node as TabContainer
				for i in range(tc.get_tab_count()):
					var child := tc.get_tab_control(i)
					if child == dock or (not tab_title.is_empty() and tc.get_tab_title(i) == tab_title):
						tc.current_tab = i
						return dock.visible
				break
			node = node.get_parent()
	return dock.visible

func _capture_editor_root() -> Image:
	var base := get_editor_interface().get_base_control()
	if base == null:
		return null
	var vp := base.get_viewport()
	if vp == null:
		return null
	var tex := vp.get_texture()
	if tex == null:
		return null
	return tex.get_image()

func _crop_dock(full: Image, dock: Control) -> Image:
	var rect := dock.get_global_rect()
	var x := int(rect.position.x)
	var y := int(rect.position.y)
	var w := int(rect.size.x)
	var h := int(rect.size.y)
	var fw := full.get_width()
	var fh := full.get_height()
	if x < 0:
		x = 0
	if y < 0:
		y = 0
	if x + w > fw:
		w = fw - x
	if y + h > fh:
		h = fh - y
	if w <= 0 or h <= 0:
		return null
	return full.get_region(Rect2i(x, y, w, h))

func _send_dock_list() -> void:
	if client == null:
		return
	var list: Array[Dictionary] = []
	for def in DOCK_DEFINITIONS:
		var dock := _resolve_dock(def.id)
		if dock == null:
			continue
		list.append({
			"id": def.id,
			"title": def.title,
			"visible": dock.visible,
		})
	client.send_event("editor.docks", { "docks": list })

func _forward_editor_pointer(message: Dictionary) -> void:
	var dock_id := str(message.get("dock", ""))
	var dock := _resolve_dock(dock_id)
	if dock == null:
		return
	var phase := str(message.get("phase", ""))
	var x := clampf(float(message.get("x", 0.0)), 0.0, 1.0)
	var y := clampf(float(message.get("y", 0.0)), 0.0, 1.0)
	var button := int(message.get("button", 0))
	var modifiers := message.get("modifiers", {}) as Dictionary
	var rect := dock.get_global_rect()
	var point := rect.position + Vector2(x * rect.size.x, y * rect.size.y)
	var base := get_editor_interface().get_base_control()
	var vp := base.get_viewport()
	if vp == null:
		return
	if phase == "moved":
		var ev := InputEventMouseMotion.new()
		ev.position = point
		ev.global_position = point
		ev.button_mask = button
		ev.ctrl_pressed = bool(modifiers.get("ctrl", false))
		ev.shift_pressed = bool(modifiers.get("shift", false))
		ev.alt_pressed = bool(modifiers.get("alt", false))
		ev.meta_pressed = bool(modifiers.get("meta", false))
		vp.push_input(ev)
	elif phase == "pressed":
		var ev := InputEventMouseButton.new()
		ev.position = point
		ev.global_position = point
		ev.button_index = MOUSE_BUTTON_LEFT if button == 0 else button
		ev.pressed = true
		ev.ctrl_pressed = bool(modifiers.get("ctrl", false))
		ev.shift_pressed = bool(modifiers.get("shift", false))
		ev.alt_pressed = bool(modifiers.get("alt", false))
		ev.meta_pressed = bool(modifiers.get("meta", false))
		vp.push_input(ev)
	elif phase == "released":
		var ev := InputEventMouseButton.new()
		ev.position = point
		ev.global_position = point
		ev.button_index = MOUSE_BUTTON_LEFT if button == 0 else button
		ev.pressed = false
		ev.ctrl_pressed = bool(modifiers.get("ctrl", false))
		ev.shift_pressed = bool(modifiers.get("shift", false))
		ev.alt_pressed = bool(modifiers.get("alt", false))
		ev.meta_pressed = bool(modifiers.get("meta", false))
		vp.push_input(ev)

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
