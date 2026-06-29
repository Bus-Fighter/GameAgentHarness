@tool
extends Node

class_name GameAgentHarnessDashboardActions

const ActionCompletedEvent := "dashboard.action.completed"

var _actions: Dictionary = {}
var _client: GameAgentHarnessClient = null

func register_action(id: String, label: String, callable: Callable) -> void:
	if id.is_empty() or label.is_empty() or callable == null or not callable.is_valid():
		push_warning("GameAgentHarness: invalid dashboard action registration for '%s'" % id)
		return
	_actions[id] = { "label": label, "callable": callable }
	_notify_dashboard()

func unregister_action(id: String) -> void:
	_actions.erase(id)
	_notify_dashboard()

func get_actions() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for id in _actions.keys():
		var entry: Dictionary = _actions[id]
		result.append({ "id": id, "label": entry.get("label", id) })
	return result

func invoke(id: String) -> Dictionary:
	var entry = _actions.get(id)
	if entry == null:
		return { "ok": false, "message": "Unknown dashboard action: '%s'" % id }
	var callable: Callable = entry.get("callable", Callable())
	if not callable.is_valid():
		return { "ok": false, "message": "Dashboard action '%s' has an invalid callable" % id }
	var result = callable.call()
	if result == null:
		return { "ok": true, "message": "Action '%s' completed" % id }
	if result is Dictionary:
		return result
	if result is bool:
		return { "ok": result, "message": "Action '%s' completed" % id }
	return { "ok": true, "message": str(result) }

func set_client(client: GameAgentHarnessClient) -> void:
	_client = client
	_notify_dashboard()

func _notify_dashboard() -> void:
	if _client != null:
		_client.send_event("dashboard.actions", { "actions": get_actions() })
