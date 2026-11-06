// Spots a SteamID typed into a search box, in the forms the API reads (`SteamId64::parse_any`).

/** SteamID64, SteamID2 (universe 0 or 1) or SteamID3. */
export const STEAMID = /^(?:\d{17}|STEAM_[01]:[01]:\d+|\[U:1:\d+\])$/;
