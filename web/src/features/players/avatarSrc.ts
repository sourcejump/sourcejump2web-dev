// Where a player's avatar comes from: the one the API has stored, or, when it has none yet, the API's avatar
// route, which fetches it from Steam on the spot (or draws a placeholder). So a player shown anywhere gets their
// picture even if they never signed in, as on ok-website.
export function avatarSrc(player: {
  steamid64: string;
  avatar_url?: string | null;
}): string {
  return (
    player.avatar_url ??
    `/v1/players/${encodeURIComponent(player.steamid64)}/avatar`
  );
}
