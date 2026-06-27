@tool
extends Control

class_name GameAgentHarnessDashboardPanel

signal dashboard_started(url: String)
signal dashboard_stopped

var _process_id: int = -1
var _harness_path: String = ""
var _dashboard_url: String = ""
var _status_label: Label
var _url_label: Label
var _intake_url_label: Label
var _start_button: Button
var _stop_button: Button
var _open_button: Button
var _editor_toggle: CheckButton
var _runtime_toggle: CheckButton
var _path_line: LineEdit
var _intake_url_line: LineEdit
var _poll_timer: Timer

func _ready() -> void:
	_harness_path = _detect_harness_path()
	_build_ui()
	_update_ui()

func _build_ui() -> void:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 12)
	margin.add_theme_constant_override("margin_right", 12)
	margin.add_theme_constant_override("margin_top", 12)
	margin.add_theme_constant_override("margin_bottom", 12)
	add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 12)
	margin.add_child(vbox)

	var title := Label.new()
	title.text = "Game Agent Harness"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 16)
	vbox.add_child(title)

	var desc := Label.new()
	desc.text = "Start the local harness dashboard to stream editor and runtime visuals to your browser."
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc.custom_minimum_size = Vector2(0, 40)
	vbox.add_child(desc)

	var toggles := HBoxContainer.new()
	toggles.add_theme_constant_override("separation", 16)
	vbox.add_child(toggles)

	_editor_toggle = CheckButton.new()
	_editor_toggle.text = "Editor capture"
	_editor_toggle.tooltip_text = "Stream editor viewport frames to the dashboard."
	_editor_toggle.button_pressed = _read_project_setting("game_agent_harness/editor_capture_enabled", true)
	_editor_toggle.toggled.connect(_on_editor_toggled)
	toggles.add_child(_editor_toggle)

	_runtime_toggle = CheckButton.new()
	_runtime_toggle.text = "Runtime capture"
	_runtime_toggle.tooltip_text = "Stream running game viewport frames to the dashboard."
	_runtime_toggle.button_pressed = _read_project_setting("game_agent_harness/runtime_capture_enabled", true)
	_runtime_toggle.toggled.connect(_on_runtime_toggled)
	toggles.add_child(_runtime_toggle)

	var path_label := Label.new()
	path_label.text = "Harness path:"
	vbox.add_child(path_label)

	_path_line = LineEdit.new()
	_path_line.text = _harness_path
	_path_line.placeholder_text = "/path/to/GameAgentHarness"
	_path_line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	vbox.add_child(_path_line)

	var intake_label := Label.new()
	intake_label.text = "Intake URL (Godot connects here):"
	vbox.add_child(intake_label)

	_intake_url_line = LineEdit.new()
	_intake_url_line.text = _read_project_setting("game_agent_harness/intake_url", "ws://127.0.0.1:8765")
	_intake_url_line.placeholder_text = "ws://127.0.0.1:8765"
	_intake_url_line.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_intake_url_line.text_changed.connect(_on_intake_url_changed)
	vbox.add_child(_intake_url_line)

	_status_label = Label.new()
	_status_label.text = "Status: stopped"
	vbox.add_child(_status_label)

	_url_label = Label.new()
	_url_label.text = "URL: -"
	_url_label.add_theme_color_override("font_color", Color.GRAY)
	vbox.add_child(_url_label)

	_intake_url_label = Label.new()
	_intake_url_label.text = "Intake: -"
	_intake_url_label.add_theme_color_override("font_color", Color.GRAY)
	vbox.add_child(_intake_url_label)

	var button_row := HBoxContainer.new()
	button_row.add_theme_constant_override("separation", 8)
	vbox.add_child(button_row)

	_start_button = Button.new()
	_start_button.text = "Start Game Agent Harness"
	_start_button.pressed.connect(start_harness)
	button_row.add_child(_start_button)

	_stop_button = Button.new()
	_stop_button.text = "Stop Dashboard"
	_stop_button.disabled = true
	_stop_button.pressed.connect(_on_stop_pressed)
	button_row.add_child(_stop_button)

	_open_button = Button.new()
	_open_button.text = "Open in Browser"
	_open_button.disabled = true
	_open_button.pressed.connect(_on_open_pressed)
	button_row.add_child(_open_button)

	_poll_timer = Timer.new()
	_poll_timer.wait_time = 1.0
	_poll_timer.timeout.connect(_poll_process)
	add_child(_poll_timer)

func _detect_harness_path() -> String:
	var project_root := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var candidates := [
		project_root.path_join("Tools").path_join("GameAgentHarness"),
		project_root.path_join("..").path_join("Tools").path_join("GameAgentHarness"),
		project_root.path_join("game-agent-harness"),
	]
	for candidate in candidates:
		var normalized := ProjectSettings.globalize_path(candidate).simplify_path()
		if DirAccess.dir_exists_absolute(normalized):
			return normalized
	return project_root.path_join("..").path_join("Tools").path_join("GameAgentHarness").simplify_path()

func start_harness() -> void:
	_harness_path = _path_line.text.strip_edges()
	if _harness_path.is_empty():
		push_warning("[GameAgentHarness] Harness path is empty")
		return
	if not DirAccess.dir_exists_absolute(_harness_path):
		push_warning("[GameAgentHarness] Harness path does not exist: %s" % _harness_path)
		return

	var cli_path := _harness_path.path_join("src").path_join("cli.js")
	if not FileAccess.file_exists(cli_path):
		push_warning("[GameAgentHarness] cli.js not found at %s" % cli_path)
		return

	var args := [cli_path, "dashboard", "start"]
	var dashboard_port := _read_project_setting("game_agent_harness/dashboard_port", 8766)
	var intake_port := _read_project_setting("game_agent_harness/intake_port", 8765)
	if dashboard_port != 8766:
		args.append_array(["--dashboard-port", str(dashboard_port)])
	if intake_port != 8765:
		args.append_array(["--port", str(intake_port)])

	var pid := OS.create_process("node", args, false)
	if pid <= 0:
		push_warning("[GameAgentHarness] Failed to start dashboard process")
		return

	_process_id = pid
	_dashboard_url = "http://127.0.0.1:%d/" % dashboard_port
	_status_label.text = "Status: starting..."
	_url_label.text = "URL: %s" % _dashboard_url
	_intake_url_label.text = "Intake: %s" % _intake_url_line.text.strip_edges()
	_poll_timer.start()
	_update_ui()
	dashboard_started.emit(_dashboard_url)

func _on_stop_pressed() -> void:
	if _process_id > 0:
		var err := OS.kill(_process_id)
		if err != OK:
			push_warning("[GameAgentHarness] Failed to kill process %d, err=%d" % [_process_id, err])
		_process_id = -1
	_dashboard_url = ""
	_status_label.text = "Status: stopped"
	_url_label.text = "URL: -"
	_intake_url_label.text = "Intake: -"
	_poll_timer.stop()
	_update_ui()
	dashboard_stopped.emit()

func _on_open_pressed() -> void:
	if not _dashboard_url.is_empty():
		OS.shell_open(_dashboard_url)

func _on_intake_url_changed(new_text: String) -> void:
	var url := new_text.strip_edges()
	if not ProjectSettings.has_setting("game_agent_harness/intake_url"):
		ProjectSettings.set_initial_value("game_agent_harness/intake_url", "ws://127.0.0.1:8765")
	ProjectSettings.set_setting("game_agent_harness/intake_url", url)
	ProjectSettings.save()

func _on_editor_toggled(enabled: bool) -> void:
	_set_capture_enabled("editor_capture_enabled", enabled)

func _on_runtime_toggled(enabled: bool) -> void:
	_set_capture_enabled("runtime_capture_enabled", enabled)

func _set_capture_enabled(key: String, enabled: bool) -> void:
	if not ProjectSettings.has_setting("game_agent_harness/" + key):
		ProjectSettings.set_initial_value("game_agent_harness/" + key, true)
	ProjectSettings.set_setting("game_agent_harness/" + key, enabled)
	ProjectSettings.save()

func _poll_process() -> void:
	if _process_id <= 0:
		return
	if not OS.is_process_running(_process_id):
		_status_label.text = "Status: exited"
		_process_id = -1
		_update_ui()
		return
	_status_label.text = "Status: running at %s" % _dashboard_url

func _update_ui() -> void:
	var running := _process_id > 0
	_start_button.disabled = running
	_stop_button.disabled = not running
	_open_button.disabled = not running or _dashboard_url.is_empty()

func _read_project_setting(key: String, default_value: Variant) -> Variant:
	if ProjectSettings.has_setting(key):
		return ProjectSettings.get_setting(key)
	return default_value

func _exit_tree() -> void:
	_on_stop_pressed()
