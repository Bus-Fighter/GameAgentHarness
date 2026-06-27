@tool
extends EditorPlugin

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")
const DashboardPanelScript := preload("res://addons/game_agent_harness/editor_dashboard_panel.gd")
const RuntimeAutoloadName := "GameAgentHarnessRuntime"
const RuntimeAutoloadPath := "res://addons/game_agent_harness/runtime_recorder.gd"

var client: GameAgentHarnessClient
var editor_selection: EditorSelection
var dashboard_panel: GameAgentHarnessDashboardPanel

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
	_send_editor_frame(true)

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
	_send_editor_frame(true)

func _emit_editor_context() -> void:
	var edited_scene_root := get_editor_interface().get_edited_scene_root()
	var entity := GameAgentHarnessClient.node_entity(edited_scene_root)
	client.send_event("editor.context", {
		"editedSceneRoot": entity
	}, entity)

func _send_editor_frame(persist: bool) -> void:
	if client == null:
		return
	if not ProjectSettings.get_setting("game_agent_harness/editor_capture_enabled", true):
		return
	var image := _capture_editor_viewport()
	if image == null:
		return
	client.send_frame(image, "editor", persist)

func _capture_editor_viewport() -> Image:
	var candidates: Array[Viewport] = []

	var main_screen := get_editor_interface().get_editor_main_screen()
	if main_screen != null:
		candidates.append(main_screen.get_viewport())

	var base := get_editor_interface().get_base_control()
	if base != null:
		candidates.append(base.get_viewport())

	var vp2d := get_editor_interface().get_editor_viewport_2d()
	if vp2d != null:
		candidates.append(vp2d)

	var vp3d := get_editor_interface().get_editor_viewport_3d()
	if vp3d != null:
		candidates.append(vp3d)

	for viewport in candidates:
		if viewport == null:
			continue
		var texture := viewport.get_texture()
		if texture == null:
			continue
		var image := texture.get_image()
		if image == null:
			continue
		if image.get_width() >= 8 and image.get_height() >= 8:
			return image

	return null
