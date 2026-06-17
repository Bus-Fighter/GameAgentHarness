@tool
extends EditorPlugin

const ClientScript := preload("res://addons/game_agent_harness/harness_client.gd")
const RuntimeAutoloadName := "GameAgentHarnessRuntime"
const RuntimeAutoloadPath := "res://addons/game_agent_harness/runtime_recorder.gd"

var client: GameAgentHarnessClient
var editor_selection: EditorSelection

func _enter_tree() -> void:
	client = ClientScript.new()
	client.name = "GameAgentHarnessEditorClient"
	add_child(client)

	add_autoload_singleton(RuntimeAutoloadName, RuntimeAutoloadPath)

	editor_selection = get_editor_interface().get_selection()
	if editor_selection != null:
		editor_selection.selection_changed.connect(_on_selection_changed)

	client.send_event("plugin.enabled", {})
	_emit_editor_context()

func _exit_tree() -> void:
	if editor_selection != null and editor_selection.selection_changed.is_connected(_on_selection_changed):
		editor_selection.selection_changed.disconnect(_on_selection_changed)

	remove_autoload_singleton(RuntimeAutoloadName)

	if client != null:
		client.send_event("plugin.disabled", {})
		client.queue_free()
		client = null

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
