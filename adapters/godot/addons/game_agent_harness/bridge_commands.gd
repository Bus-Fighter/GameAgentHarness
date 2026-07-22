extends RefCounted

const Util := preload("res://addons/game_agent_harness/command_util.gd")

const DEFAULT_MAX_DEPTH := 8
const HARD_MAX_DEPTH := 32
const DEFAULT_MAX_NODES := 2000
const HARD_MAX_NODES := 10000
const MAX_CALL_ARGS := 4

var _client: Node

func _init(client: Node) -> void:
	_client = client

func dispatch(command: String, params: Dictionary) -> Dictionary:
	if _client == null or _client.get_tree() == null:
		return _err("game tree is not available")
	match command:
		"get_tree":
			return _cmd_get_tree(params)
		"get_node":
			return _cmd_get_node(params)
		"set_property":
			return _cmd_set_property(params)
		"call_method":
			return _cmd_call_method(params)
		"input_key":
			return _cmd_input_key(params)
		"input_action":
			return _cmd_input_action(params)
		"input_text":
			return _cmd_input_text(params)
		"get_performance":
			return _cmd_get_performance()
		"screenshot":
			return _cmd_screenshot(params)
		"console_list":
			return _cmd_bridge_no_params("ConsoleList", "commands")
		"console_exec":
			return _cmd_console_exec(params)
		"actor_list":
			return _cmd_bridge_list("ActorList")
		"actor_get":
			return _cmd_actor_get(params)
		"binding_list_types":
			return _cmd_bridge_list("BindingListTypes")
		"binding_get_keys":
			return _cmd_binding_get_keys(params)
		"binding_list_sources":
			return _cmd_bridge_list("BindingListSources")
		_:
			return _err("unknown game command: %s" % command)

const HARNESS_BRIDGE_CLASS := "HarnessBridge"
const HARNESS_BRIDGE_FALLBACK_SCRIPT := "res://Scripts/Core/Harness/HarnessBridge.cs"

func _get_harness_bridge() -> Node:
	var root := _client.get_tree().root
	if root == null:
		return null
	var existing := root.get_node_or_null(NodePath(HARNESS_BRIDGE_CLASS))
	if existing != null:
		return existing
	var script_path := ""
	for entry in ProjectSettings.get_global_class_list():
		if str(entry.get("class", "")) == HARNESS_BRIDGE_CLASS:
			script_path = str(entry.get("path", ""))
			break
	if script_path.is_empty() and ResourceLoader.exists(HARNESS_BRIDGE_FALLBACK_SCRIPT):
		script_path = HARNESS_BRIDGE_FALLBACK_SCRIPT
	if script_path.is_empty():
		return null
	var script = load(script_path)
	if script == null:
		return null
	var node = script.new()
	if node == null or not (node is Node):
		return null
	node.name = HARNESS_BRIDGE_CLASS
	root.add_child(node)
	return node

func _call_bridge_json(method: String, args: Array = []) -> Dictionary:
	var bridge := _get_harness_bridge()
	if bridge == null:
		return _err("HarnessBridge class not found in project (game-side bridge missing)")
	if not bridge.has_method(method):
		return _err("HarnessBridge has no method: %s" % method)
	var raw = bridge.callv(method, args)
	if typeof(raw) != TYPE_STRING:
		return _err("HarnessBridge.%s returned non-string result" % method)
	var parsed = JSON.parse_string(raw)
	if parsed == null:
		return _err("HarnessBridge.%s returned invalid JSON" % method)
	return { "ok": true, "parsed": parsed }

func _cmd_bridge_list(method: String) -> Dictionary:
	var result := _call_bridge_json(method)
	if not result.ok:
		return _err(result.error)
	if result.parsed is Dictionary and result.parsed.has("error"):
		return _err(str(result.parsed.get("error")))
	return _ok(result.parsed)

func _cmd_bridge_no_params(method: String, wrap_key: String) -> Dictionary:
	var result := _call_bridge_json(method)
	if not result.ok:
		return _err(result.error)
	if result.parsed is Dictionary and result.parsed.has("error"):
		return _err(str(result.parsed.get("error")))
	return _ok({ wrap_key: result.parsed })

func _cmd_console_exec(params: Dictionary) -> Dictionary:
	var input := str(params.get("input", ""))
	if input.is_empty():
		return _err("input is required")
	var result := _call_bridge_json("ConsoleExec", [input])
	if not result.ok:
		return _err(result.error)
	return _ok(result.parsed)

func _cmd_actor_get(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	if path.is_empty():
		return _err("path is required")
	var result := _call_bridge_json("ActorGet", [path])
	if not result.ok:
		return _err(result.error)
	if result.parsed is Dictionary and result.parsed.has("error"):
		return _err(str(result.parsed.get("error")))
	return _ok(result.parsed)

func _cmd_binding_get_keys(params: Dictionary) -> Dictionary:
	var type_name := str(params.get("type", ""))
	if type_name.is_empty():
		return _err("type is required")
	var result := _call_bridge_json("BindingGetKeys", [type_name])
	if not result.ok:
		return _err(result.error)
	if result.parsed is Dictionary and result.parsed.has("error"):
		return _err(str(result.parsed.get("error")))
	return _ok(result.parsed)

func _ok(data: Variant = null) -> Dictionary:
	return { "ok": true, "data": data, "error": null }

func _err(message: String) -> Dictionary:
	return { "ok": false, "data": null, "error": message }

func _find_node(path: String) -> Node:
	var root := _client.get_tree().root
	if root == null:
		return null
	if path.is_empty() or path == "/root" or path == str(root.get_path()):
		return root
	var normalized := path
	if normalized.begins_with("/root/"):
		normalized = normalized.trim_prefix("/root/")
	elif normalized.begins_with("/root"):
		normalized = normalized.trim_prefix("/root")
	return root.get_node_or_null(NodePath(normalized))

func _cmd_get_tree(params: Dictionary) -> Dictionary:
	var root := _client.get_tree().root
	if root == null:
		return _err("no scene tree root")
	var max_depth := clampi(int(params.get("depth", DEFAULT_MAX_DEPTH)), 1, HARD_MAX_DEPTH)
	var max_nodes := clampi(int(params.get("maxNodes", DEFAULT_MAX_NODES)), 1, HARD_MAX_NODES)
	var include_internal := bool(params.get("includeInternal", false))
	var state := { "count": 0, "truncated": false }
	var tree := _build_tree(root, 0, max_depth, max_nodes, include_internal, state)
	return _ok({ "root": tree, "nodeCount": state.count, "truncated": state.truncated })

func _build_tree(node: Node, depth: int, max_depth: int, max_nodes: int, include_internal: bool, state: Dictionary) -> Dictionary:
	if state.count >= max_nodes:
		state.truncated = true
		return {}
	state.count += 1
	var out := Util.node_summary(node)
	if depth >= max_depth:
		if node.get_child_count(include_internal) > 0:
			state.truncated = true
		out["children"] = []
		return out
	var children: Array = []
	for child in node.get_children(include_internal):
		if state.count >= max_nodes:
			state.truncated = true
			break
		children.append(_build_tree(child, depth + 1, max_depth, max_nodes, include_internal, state))
	out["children"] = children
	return out

func _cmd_get_node(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	var node := _find_node(path)
	if node == null:
		return _err("node not found: %s" % path)
	return _ok(Util.node_summary(node))

func _cmd_set_property(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	var property := str(params.get("property", ""))
	if property.is_empty():
		return _err("property is required")
	var node := _find_node(path)
	if node == null:
		return _err("node not found: %s" % path)
	var value = Util.decode_value(params.get("value"))
	node.set(property, value)
	return _ok({ "node": str(node.get_path()), "property": property, "value": Util.serialize_value(node.get(property)) })

func _cmd_call_method(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	var method := str(params.get("method", ""))
	if method.is_empty():
		return _err("method is required")
	if method.begins_with("_"):
		return _err("methods starting with '_' are not callable")
	var node := _find_node(path)
	if node == null:
		return _err("node not found: %s" % path)
	if not node.has_method(method):
		return _err("node has no method: %s" % method)
	var args := params.get("args", []) as Array
	if args.size() > MAX_CALL_ARGS:
		return _err("too many args (max %d)" % MAX_CALL_ARGS)
	var decoded: Array = []
	for arg in args:
		decoded.append(Util.decode_value(arg))
	var result = node.callv(method, decoded)
	return _ok({ "node": str(node.get_path()), "method": method, "result": Util.serialize_value(result) })

func _cmd_input_key(params: Dictionary) -> Dictionary:
	var keycode_name := str(params.get("keycode", ""))
	if keycode_name.is_empty():
		return _err("keycode is required")
	var keycode := OS.find_keycode_from_string(keycode_name)
	if keycode == KEY_NONE:
		return _err("unknown keycode: %s" % keycode_name)
	var pressed := bool(params.get("pressed", true))
	var event := InputEventKey.new()
	event.keycode = keycode
	event.pressed = pressed
	Input.parse_input_event(event)
	return _ok({ "keycode": keycode_name, "pressed": pressed })

func _cmd_input_action(params: Dictionary) -> Dictionary:
	var action := str(params.get("action", ""))
	if action.is_empty():
		return _err("action is required")
	var pressed := bool(params.get("pressed", true))
	if pressed:
		Input.action_press(action)
	else:
		Input.action_release(action)
	return _ok({ "action": action, "pressed": pressed })

func _cmd_input_text(params: Dictionary) -> Dictionary:
	var text := str(params.get("text", ""))
	if text.is_empty():
		return _err("text is required")
	for i in range(text.length()):
		var event := InputEventKey.new()
		event.unicode = text.unicode_at(i)
		event.pressed = true
		Input.parse_input_event(event)
		var release := InputEventKey.new()
		release.unicode = text.unicode_at(i)
		release.pressed = false
		Input.parse_input_event(release)
	return _ok({ "length": text.length() })

func _cmd_get_performance() -> Dictionary:
	return _ok({
		"fps": Performance.get_monitor(Performance.TIME_FPS),
		"frameTimeMs": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"physicsFrameTimeMs": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		"memoryStaticBytes": Performance.get_monitor(Performance.MEMORY_STATIC),
		"memoryStaticMaxBytes": Performance.get_monitor(Performance.MEMORY_STATIC_MAX),
		"objectCount": Performance.get_monitor(Performance.OBJECT_COUNT),
		"nodeCount": Performance.get_monitor(Performance.OBJECT_NODE_COUNT)
	})

func _cmd_screenshot(params: Dictionary) -> Dictionary:
	var viewport := _client.get_tree().root
	if viewport == null:
		return _err("no root viewport")
	var texture := viewport.get_texture()
	if texture == null:
		return _err("viewport texture unavailable")
	var image := texture.get_image()
	if image == null:
		return _err("could not read viewport image")
	var persist := bool(params.get("persist", false))
	if _client.has_method("send_frame"):
		_client.send_frame(image, "bridge", persist, true)
	return _ok({ "width": image.get_width(), "height": image.get_height(), "format": "jpeg", "persist": persist })
