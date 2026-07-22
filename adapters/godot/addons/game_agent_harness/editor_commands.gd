@tool
extends RefCounted

const Util := preload("res://addons/game_agent_harness/command_util.gd")

const DEFAULT_MAX_DEPTH := 8
const HARD_MAX_DEPTH := 32
const DEFAULT_MAX_NODES := 2000
const HARD_MAX_NODES := 10000

func dispatch(command: String, params: Dictionary) -> Dictionary:
	if not Engine.is_editor_hint():
		return _err("editor commands are only available inside the editor")
	match command:
		"ping":
			return _cmd_ping()
		"get_scene_tree":
			return _cmd_get_scene_tree(params)
		"open_scene":
			return _cmd_open_scene(params)
		"save_scene":
			return _cmd_save_scene()
		"play_scene":
			return _cmd_play_scene()
		"stop_play":
			return _cmd_stop_play()
		"add_node":
			return _cmd_add_node(params)
		"remove_node":
			return _cmd_remove_node(params)
		"set_property":
			return _cmd_set_property(params)
		"undo":
			return _cmd_undo()
		"redo":
			return _cmd_redo()
		"select":
			return _cmd_select(params)
		_:
			return _err("unknown editor command: %s" % command)

func _ok(data: Variant = null) -> Dictionary:
	return { "ok": true, "data": data, "error": null }

func _err(message: String) -> Dictionary:
	return { "ok": false, "data": null, "error": message }

func _edited_root() -> Node:
	return EditorInterface.get_edited_scene_root()

func _find_edited_node(path: String) -> Node:
	var root := _edited_root()
	if root == null:
		return null
	if path.is_empty() or path == "." or path == str(root.name) or path == str(root.get_path()):
		return root
	return root.get_node_or_null(NodePath(path))

func _cmd_ping() -> Dictionary:
	var root := _edited_root()
	return _ok({
		"version": Engine.get_version_info().get("string", ""),
		"scenePath": root.scene_file_path if root != null else "",
		"playing": EditorInterface.is_playing_scene()
	})

func _cmd_get_scene_tree(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no scene is currently open in the editor")
	var max_depth := clampi(int(params.get("depth", DEFAULT_MAX_DEPTH)), 1, HARD_MAX_DEPTH)
	var max_nodes := clampi(int(params.get("maxNodes", DEFAULT_MAX_NODES)), 1, HARD_MAX_NODES)
	var state := { "count": 0, "truncated": false }
	var tree := _build_tree(root, 0, max_depth, max_nodes, state)
	return _ok({ "root": tree, "nodeCount": state.count, "truncated": state.truncated })

func _build_tree(node: Node, depth: int, max_depth: int, max_nodes: int, state: Dictionary) -> Dictionary:
	if state.count >= max_nodes:
		state.truncated = true
		return {}
	state.count += 1
	var out := Util.node_summary(node)
	if depth >= max_depth:
		if node.get_child_count() > 0:
			state.truncated = true
		out["children"] = []
		return out
	var children: Array = []
	for i in range(node.get_child_count()):
		if state.count >= max_nodes:
			state.truncated = true
			break
		children.append(_build_tree(node.get_child(i), depth + 1, max_depth, max_nodes, state))
	out["children"] = children
	return out

func _cmd_open_scene(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	if path.is_empty():
		return _err("path is required")
	var res_path := path if path.begins_with("res://") else "res://" + path.replace("\\", "/")
	if not FileAccess.file_exists(res_path):
		return _err("file not found: %s" % res_path)
	EditorInterface.open_scene_from_path(res_path)
	return _ok({ "path": res_path })

func _cmd_save_scene() -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no scene is currently open in the editor")
	var err := EditorInterface.save_scene()
	if err != OK:
		return _err("save failed with error %d" % err)
	return _ok({ "path": root.scene_file_path })

func _cmd_play_scene() -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("cannot play: no scene is currently open in the editor")
	if EditorInterface.is_playing_scene():
		return _err("a scene is already playing")
	EditorInterface.play_current_scene()
	return _ok({ "playing": true, "scenePath": root.scene_file_path })

func _cmd_stop_play() -> Dictionary:
	if not EditorInterface.is_playing_scene():
		return _ok({ "playing": false, "note": "nothing was playing" })
	EditorInterface.stop_playing_scene()
	return _ok({ "playing": false })

func _cmd_add_node(params: Dictionary) -> Dictionary:
	var parent_path := str(params.get("parent_path", ""))
	var node_type := str(params.get("node_type", "Node"))
	var node_name := str(params.get("node_name", ""))
	if node_name.is_empty():
		return _err("node_name is required")
	var parent := _find_edited_node(parent_path)
	if parent == null:
		return _err("parent node not found: %s" % parent_path)
	if not ClassDB.class_exists(node_type) or not ClassDB.is_parent_class(node_type, "Node"):
		return _err("invalid node type: %s" % node_type)
	var node: Node = ClassDB.instantiate(node_type)
	if node == null:
		return _err("could not instantiate type: %s" % node_type)
	node.name = node_name
	var root := _edited_root()
	var ur := EditorInterface.get_editor_undo_redo()
	ur.create_action("Harness Add Node")
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	var properties := params.get("properties", {}) as Dictionary
	for key in properties.keys():
		node.set(str(key), Util.decode_value(properties[key]))
	return _ok({ "node": Util.node_summary(node) })

func _cmd_remove_node(params: Dictionary) -> Dictionary:
	if not bool(params.get("confirm", false)):
		return _err("remove_node requires confirm=true")
	var path := str(params.get("path", ""))
	var node := _find_edited_node(path)
	if node == null:
		return _err("node not found: %s" % path)
	var root := _edited_root()
	if node == root:
		return _err("cannot remove the scene root")
	var parent := node.get_parent()
	if parent == null:
		return _err("node has no parent: %s" % path)
	var index := node.get_index()
	var ur := EditorInterface.get_editor_undo_redo()
	ur.create_action("Harness Remove Node")
	ur.add_do_method(parent, "remove_child", node)
	ur.add_undo_method(parent, "add_child", node)
	ur.add_undo_method(parent, "move_child", node, index)
	ur.add_undo_method(node, "set_owner", root)
	ur.add_undo_reference(node)
	ur.commit_action()
	return _ok({ "removed": path })

func _cmd_set_property(params: Dictionary) -> Dictionary:
	var path := str(params.get("node_path", ""))
	var property := str(params.get("property", ""))
	if property.is_empty():
		return _err("property is required")
	var node := _find_edited_node(path)
	if node == null:
		return _err("node not found: %s" % path)
	var old_value = node.get(property)
	var new_value = Util.decode_value(params.get("value"))
	var ur := EditorInterface.get_editor_undo_redo()
	ur.create_action("Harness Set Property")
	ur.add_do_property(node, property, new_value)
	ur.add_undo_property(node, property, old_value)
	ur.commit_action()
	return _ok({ "node": str(node.get_path()), "property": property, "value": Util.serialize_value(node.get(property)) })

func _cmd_undo() -> Dictionary:
	var ur := EditorInterface.get_editor_undo_redo()
	if not ur.has_undo():
		return _err("nothing to undo")
	ur.undo()
	return _ok({ "action": ur.get_current_action_name() })

func _cmd_redo() -> Dictionary:
	var ur := EditorInterface.get_editor_undo_redo()
	if not ur.has_redo():
		return _err("nothing to redo")
	ur.redo()
	return _ok({ "action": ur.get_current_action_name() })

func _cmd_select(params: Dictionary) -> Dictionary:
	var path := str(params.get("node_path", ""))
	var node := _find_edited_node(path)
	if node == null:
		return _err("node not found: %s" % path)
	var selection := EditorInterface.get_selection()
	if selection == null:
		return _err("editor selection unavailable")
	selection.clear()
	selection.add_node(node)
	return _ok({ "selected": str(node.get_path()) })
