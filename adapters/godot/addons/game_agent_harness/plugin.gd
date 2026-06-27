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

func _enter_tree() -> void:
	client = ClientScript.new()
	client.name = "GameAgentHarnessEditorClient"
	add_child(client)

	add_autoload_singleton(RuntimeAutoloadName, RuntimeAutoloadPath)

	editor_selection = get_editor_interface().get_selection()
	if editor_selection != null:
		editor_selection.selection_changed.connect(_on_selection_changed)

	dashboard_panel = DashboardPanelScript.new()
	dashboard_panel.name = "GameAgentHarnessDashboard"
	add_control_to_dock(DOCK_SLOT_LEFT_UL, dashboard_panel)

	add_tool_menu_item("Start Game Agent Harness", _on_tool_menu_start)

	client.send_event("plugin.enabled", {})
	_emit_editor_context()
	set_process(true)

func _process(_delta: float) -> void:
	var playing := get_editor_interface().is_playing_scene()
	if playing == _runtime_running:
		return
	_runtime_running = playing
	if playing:
		client.send_event("runtime.started", {
			"scene": get_editor_interface().get_edited_scene_root()?.scene_file_path
		})
	else:
		client.send_event("runtime.stopped", {})

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

func _on_harness_control(message: Dictionary) -> void:
	var action := str(message.get("action", ""))
	if action == "play":
		get_editor_interface().play_current_scene()
	elif action == "stop":
		get_editor_interface().stop_playing_scene()
	elif action == "snapshot" or action == "pause" or action == "input.pointer":
		# Forwarded to runtime autoload when available
		var runtime := get_tree().root.get_node_or_null(RuntimeAutoloadName)
		if runtime != null and runtime.has_method("_on_harness_control"):
			runtime._on_harness_control(message)

func _on_selection_changed() -> void:
	if client == null or editor_selection == null:
		return

	var nodes := editor_selection.get_selected_nodes()
	var selected: Array[Dictionary] = []
	for node in nodes:
		selected.append(GameAgentHarnessClient.node_entity(node))

	var primary: Dictionary = selected[0] if selected.size() > 0 else {}
	client.send_event("selection.changed", {
		"count": selected.size(),
		"selected": selected
	}, primary)

func _emit_editor_context() -> void:
	var edited_scene_root := get_editor_interface().get_edited_scene_root()
	var entity := GameAgentHarnessClient.node_entity(edited_scene_root)
	client.send_event("editor.context", {
		"editedSceneRoot": entity
	}, entity)
