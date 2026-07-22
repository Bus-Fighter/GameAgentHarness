@tool
extends RefCounted

const EditorCommands := preload("res://addons/game_agent_harness/editor_commands.gd")
const BridgeCommands := preload("res://addons/game_agent_harness/bridge_commands.gd")

var _client: Node
var _editor_commands: RefCounted
var _bridge_commands: RefCounted

func _init(client: Node) -> void:
	_client = client
	_editor_commands = EditorCommands.new()
	_bridge_commands = BridgeCommands.new(client)

func handle_command(message: Dictionary) -> void:
	var id := str(message.get("id", ""))
	var domain := str(message.get("domain", ""))
	var command := str(message.get("command", ""))
	var params := message.get("params", {})
	if not (params is Dictionary):
		params = {}
	var result := _dispatch(domain, command, params)
	_client.send_message({
		"kind": "event",
		"type": "cmd.result",
		"id": id,
		"ok": bool(result.get("ok", false)),
		"data": result.get("data", null),
		"error": result.get("error", null)
	})

func _dispatch(domain: String, command: String, params: Dictionary) -> Dictionary:
	var result: Dictionary
	match domain:
		"editor":
			result = _editor_commands.dispatch(command, params)
		"game":
			result = _bridge_commands.dispatch(command, params)
		_:
			result = { "ok": false, "data": null, "error": "unknown domain: %s" % domain }
	if not (result is Dictionary):
		return { "ok": false, "data": null, "error": "handler for %s.%s failed" % [domain, command] }
	if not result.has("ok"):
		return { "ok": false, "data": null, "error": "handler for %s.%s returned an invalid result" % [domain, command] }
	return result
