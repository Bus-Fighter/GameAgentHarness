@tool
extends RefCounted

static func decode_value(value: Variant) -> Variant:
	if value is Dictionary:
		if value.has("x") and value.has("y"):
			if value.has("z") and value.has("w") and value.size() == 4:
				return Quaternion(float(value.x), float(value.y), float(value.z), float(value.w))
			if value.has("z") and value.size() == 3:
				return Vector3(float(value.x), float(value.y), float(value.z))
			if value.size() == 2:
				return Vector2(float(value.x), float(value.y))
		if value.has("r") and value.has("g") and value.has("b"):
			return Color(float(value.r), float(value.g), float(value.b), float(value.get("a", 1.0)))
		var out: Dictionary = {}
		for key in value.keys():
			out[key] = decode_value(value[key])
		return out
	if value is Array:
		var out: Array = []
		for item in value:
			out.append(decode_value(item))
		return out
	return value

static func serialize_value(value: Variant) -> Variant:
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_VECTOR2, TYPE_VECTOR2I:
			return { "x": value.x, "y": value.y }
		TYPE_VECTOR3, TYPE_VECTOR3I:
			return { "x": value.x, "y": value.y, "z": value.z }
		TYPE_VECTOR4, TYPE_VECTOR4I, TYPE_QUATERNION:
			return { "x": value.x, "y": value.y, "z": value.z, "w": value.w }
		TYPE_RECT2, TYPE_RECT2I:
			return { "position": { "x": value.position.x, "y": value.position.y }, "size": { "x": value.size.x, "y": value.size.y } }
		TYPE_COLOR:
			return { "r": value.r, "g": value.g, "b": value.b, "a": value.a }
		TYPE_NODE_PATH:
			return str(value)
		TYPE_ARRAY, TYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_VECTOR2_ARRAY, TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_COLOR_ARRAY:
			var out: Array = []
			for item in value:
				out.append(serialize_value(item))
			return out
		TYPE_DICTIONARY:
			var out: Dictionary = {}
			for key in value.keys():
				out[str(key)] = serialize_value(value[key])
			return out
		TYPE_OBJECT:
			if value is Node:
				return { "nodePath": str((value as Node).get_path()), "type": (value as Node).get_class() }
			if value is Resource:
				return { "resourcePath": (value as Resource).resource_path, "type": (value as Resource).get_class() }
			return str(value)
		_:
			return var_to_str(value)

static func node_summary(node: Node) -> Dictionary:
	if node == null:
		return {}
	var out: Dictionary = {
		"name": str(node.name),
		"type": node.get_class(),
		"path": str(node.get_path()),
		"childCount": node.get_child_count(),
		"owner": str(node.owner.get_path()) if node.owner != null else ""
	}
	if node is Node2D:
		out["position"] = serialize_value((node as Node2D).position)
		out["rotation"] = (node as Node2D).rotation
		out["scale"] = serialize_value((node as Node2D).scale)
	if node is Node3D:
		out["position"] = serialize_value((node as Node3D).position)
		out["rotation"] = serialize_value((node as Node3D).rotation)
		out["scale"] = serialize_value((node as Node3D).scale)
	if node is Control:
		out["size"] = serialize_value((node as Control).size)
	if node is CanvasItem:
		out["visible"] = (node as CanvasItem).visible
	if node is Label or node is Button or node is LineEdit:
		out["text"] = str(node.get("text"))
	if node is Range:
		out["value"] = (node as Range).value
		out["minValue"] = (node as Range).min_value
		out["maxValue"] = (node as Range).max_value
	return out
