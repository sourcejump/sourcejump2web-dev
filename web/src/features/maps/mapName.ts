// The map names SourceJump accepts (the API's `MapName`), for checking a name before sending it.

/** On a lowercased name: up to 64 of a-z, 0-9, `_`, `-` and `.`, but not only dots (`.` and `..` are paths). */
export const MAP_NAME = /^(?!\.+$)[a-z0-9_.-]{1,64}$/;
