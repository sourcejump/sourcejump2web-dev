// Every player and admin command in SourceJump's server release, grouped by the plugin that adds it, for the Commands page.
//
// Read from release 0.3.22: the 16 timer plugins (shavit-*.smx) and sourcejump.smx. Update it when a release adds,
// renames or removes a command. Commands the plugins only listen to, or that exist only in debug builds, are left
// out.

/** SourceMod admin flags the commands below need, and what SourceMod calls each. */
export const adminFlags = {
  z: "root",
  m: "rcon",
  d: "ban",
  g: "changemap",
  j: "chat",
} as const;

export type AdminFlag = keyof typeof adminFlags;

/** Who may use a command: anyone, an admin with the flag, or players an admin has given access to. */
export type Who = "everyone" | "granted" | { flag: AdminFlag };

/** Text with some parts shown as code, such as another command's name. */
export type Text = string | readonly (string | { code: string })[];

export interface Command {
  /** As typed in chat (`!r`), or in the console for admin-only commands (`sm_deletemap`). */
  name: string;
  /** Arguments after the name: `<required>`, `[optional]`. */
  args?: string;
  /** Other names for the same command. */
  aliases?: readonly string[];
  /** Keys to bind instead of typing it (TAS): on while held. */
  binds?: readonly string[];
  who: Who;
  description: Text;
}

export interface CommandGroup {
  /** The section's anchor. */
  id: string;
  title: string;
  /** The plugin files that add these commands. */
  plugins: readonly string[];
  /** Shown above the table. */
  intro?: Text;
  /** Shown under the table. */
  notes?: readonly Text[];
  commands: readonly Command[];
}

export interface StyleCommands {
  style: string;
  commands: readonly string[];
}

const everyone = "everyone";

export const commandGroups: readonly CommandGroup[] = [
  {
    id: "timer",
    title: "Timer",
    // `!synctoggle` comes with SourceJump's plugin, which replaced the separate autosync one, but players look
    // for it beside `!auto`.
    plugins: ["shavit-core", "sourcejump"],
    commands: [
      {
        name: "!style",
        aliases: ["!styles", "!diff", "!difficulty"],
        who: everyone,
        description: "Opens the style menu.",
      },
      {
        name: "!r",
        aliases: ["!restart", "!start"],
        who: everyone,
        description: "Restarts your timer on the track you're on.",
      },
      {
        name: "!m",
        aliases: ["!main"],
        who: everyone,
        description: "Restarts your timer on the main track.",
      },
      {
        name: "!b",
        aliases: ["!bonus"],
        who: everyone,
        description: "Restarts your timer on the bonus track.",
      },
      {
        name: "!b1 … !b8",
        who: everyone,
        description: "Restarts your timer on bonus 1 to 8.",
      },
      {
        name: "!end",
        who: everyone,
        description: "Teleports you to the main track's end zone.",
      },
      {
        name: "!bend",
        aliases: ["!bonusend"],
        who: everyone,
        description: "Teleports you to the bonus track's end zone.",
      },
      { name: "!stop", who: everyone, description: "Stops your timer." },
      {
        name: "!pause",
        aliases: ["!unpause", "!resume"],
        who: everyone,
        description: "Pauses or resumes your timer.",
      },
      {
        name: "!auto",
        aliases: ["!autobhop"],
        who: everyone,
        description: "Toggles autobhop, on styles that allow it.",
      },
      {
        name: "!synctoggle",
        who: everyone,
        description: "Turns autosync on or off, on styles that have it.",
      },
      {
        name: "!timescale",
        args: "<value>",
        aliases: ["!ts"],
        who: everyone,
        description: "Sets your timescale on TAS styles.",
      },
      {
        name: "!tsplus",
        args: "[value]",
        aliases: ["!timescaleplus"],
        who: everyone,
        description:
          "Adds the value to your timescale. With no value: the next preset, up to 1.0.",
      },
      {
        name: "!tsminus",
        args: "[value]",
        aliases: ["!timescaleminus"],
        who: everyone,
        description:
          "Subtracts the value from your timescale. With no value: the next preset, down to 0.01.",
      },
      {
        name: "!ihate!main",
        who: everyone,
        description: [
          "Toggles whether ",
          { code: "!r" },
          " always takes you back to the main track instead of the track you're on.",
        ],
      },
      {
        name: "sm_deletemap",
        args: "<map>",
        who: { flag: "z" },
        description: "Deletes all of a map's data.",
      },
      {
        name: "sm_wipeplayer",
        args: "<steamid3> [style]",
        who: { flag: "d" },
        description:
          "Deletes all of a player's timer data, or only their times on one style.",
      },
      {
        name: "sm_wipetrack",
        who: { flag: "z" },
        description: "Deletes all runs on a track.",
      },
      {
        name: "sm_migration",
        args: "<id | all>",
        who: { flag: "z" },
        description: "Runs a database migration again.",
      },
    ],
  },
  {
    id: "checkpoints",
    title: "Checkpoints",
    plugins: ["shavit-checkpoints"],
    commands: [
      {
        name: "!cp",
        aliases: ["!cpmenu", "!checkpoint", "!checkpoints"],
        who: everyone,
        description: "Opens the checkpoint menu.",
      },
      { name: "!save", who: everyone, description: "Saves a checkpoint." },
      {
        name: "!tele",
        args: "[number]",
        aliases: ["!teleport"],
        who: everyone,
        description:
          "Teleports you to your current checkpoint, or to the numbered one.",
      },
      {
        name: "!prevcp",
        who: everyone,
        description: "Selects the previous checkpoint.",
      },
      {
        name: "!nextcp",
        who: everyone,
        description: "Selects the next checkpoint.",
      },
      {
        name: "!deletecp",
        who: everyone,
        description: "Deletes the current checkpoint.",
      },
    ],
  },
  {
    id: "hud",
    title: "HUD",
    plugins: ["shavit-hud"],
    commands: [
      {
        name: "!hud",
        aliases: ["!options"],
        who: everyone,
        description: "Opens the HUD settings menu.",
      },
      {
        name: "!keys",
        aliases: ["!showkeys"],
        who: everyone,
        description: "Toggles the key display.",
      },
      {
        name: "!master",
        aliases: ["!masterhud"],
        who: everyone,
        description: "Turns the whole HUD on or off.",
      },
      {
        name: "!center",
        aliases: ["!centerhud"],
        who: everyone,
        description: "Toggles the center text HUD.",
      },
      { name: "!zonehud", who: everyone, description: "Toggles the zone HUD." },
      {
        name: "!cpr",
        who: everyone,
        description: "Opens the time difference comparison menu.",
      },
      {
        name: "!hideweapon",
        aliases: ["!hideweap", "!hidewep", "!hideweps"],
        who: everyone,
        description: "Toggles hiding your weapon.",
      },
      {
        name: "!truevel",
        aliases: ["!truvel", "!2dvel"],
        who: everyone,
        description: "Toggles showing your 2D (“true”) speed.",
      },
    ],
  },
  {
    id: "records",
    title: "Records",
    plugins: ["shavit-wr"],
    commands: [
      {
        name: "!wr",
        args: "[map]",
        aliases: [
          "!worldrecord",
          "!sr",
          "!serverrecord",
          "!wrsj",
          "!sjwr",
          "!sjrecords",
        ],
        who: everyone,
        description: "Shows a map's leaderboard.",
      },
      {
        name: "!bwr",
        args: "[map] [bonus]",
        aliases: [
          "!bworldrecord",
          "!bonusworldrecord",
          "!bsr",
          "!bserverrecord",
          "!bonusserverrecord",
        ],
        who: everyone,
        description: "Shows a map's bonus leaderboard.",
      },
      {
        name: "!wr<style>",
        aliases: ["!sr<style>"],
        who: everyone,
        description: [
          "Shows the leaderboard on one style. Add a style's command with no space: ",
          { code: "!wrsw" },
          ", ",
          { code: "!wrseg" },
          ", ",
          { code: "!wr400" },
          ".",
        ],
      },
      {
        name: "!bwr<style>",
        aliases: ["!bsr<style>"],
        who: everyone,
        description: [
          "The same for the bonus, such as ",
          { code: "!bwrsw" },
          ".",
        ],
      },
      {
        name: "!pb",
        aliases: ["!time", "!times"],
        who: everyone,
        description: "Shows a player's time on a map.",
      },
      {
        name: "!recent",
        aliases: ["!rr", "!recentrecords"],
        who: everyone,
        description: "Shows the recent #1 times.",
      },
      {
        name: "!wrdisplay",
        who: everyone,
        description:
          "Picks which styles' SourceJump record announcements you see.",
      },
      {
        name: "sm_delete",
        aliases: ["sm_deleterecord", "sm_deleterecords"],
        who: { flag: "m" },
        description: "Opens the record deletion menu.",
      },
      {
        name: "sm_deleteall",
        who: { flag: "m" },
        description: "Deletes all records on this map.",
      },
    ],
  },
  {
    id: "rankings",
    title: "Rankings",
    plugins: ["shavit-rankings"],
    commands: [
      {
        name: "!tier",
        aliases: ["!maptier"],
        who: everyone,
        description: "Prints the map's tier.",
      },
      {
        name: "!rank",
        args: "[name]",
        who: everyone,
        description: "Shows your rank or someone else's.",
      },
      {
        name: "!top",
        who: everyone,
        description: "Shows the top 100 players.",
      },
      {
        name: "sm_settier",
        args: "<tier> [map]",
        aliases: ["sm_setmaptier"],
        who: { flag: "m" },
        description: "Changes a map's tier.",
      },
      {
        name: "sm_recalcmap",
        who: { flag: "m" },
        description: "Recalculates the points of this map's records.",
      },
      {
        name: "sm_recalcall",
        who: { flag: "z" },
        description:
          "Recalculates the points for every map. Run it after changing a style's ranking multiplier.",
      },
    ],
  },
  {
    id: "stats",
    title: "Stats",
    plugins: ["shavit-stats"],
    commands: [
      {
        name: "!profile",
        args: "[player]",
        aliases: ["!p", "!stats"],
        who: everyone,
        description: "Shows a player's profile.",
      },
      {
        name: "!mapsdone",
        args: "[player]",
        who: everyone,
        description: "Shows the maps a player has finished.",
      },
      {
        name: "!mapsleft",
        args: "[player]",
        who: everyone,
        description: "Shows the maps a player hasn't finished.",
      },
      {
        name: "!playtime",
        who: everyone,
        description: "Shows the top playtime list.",
      },
    ],
  },
  {
    id: "zones",
    title: "Zones",
    plugins: ["shavit-zones", "shavit-zones-json"],
    commands: [
      {
        name: "!zones",
        aliases: ["!addzone", "!mapzones"],
        who: everyone,
        description: [
          "For admins (m), opens the zone editor. For everyone else, opens ",
          { code: "!splits" },
          ".",
        ],
      },
      {
        name: "!stages",
        args: "[number]",
        aliases: ["!stage", "!s"],
        who: everyone,
        description: "Opens the stage menu, or goes to the numbered stage.",
      },
      {
        name: "!s0 … !s9",
        who: everyone,
        description: "Goes to stage 0 to 9.",
      },
      {
        name: "!rs",
        aliases: ["!stagerestart", "!restartstage"],
        who: everyone,
        description:
          "Teleports you back to the start of your current stage (surf maps).",
      },
      {
        name: "!set",
        aliases: ["!setstart", "!ss", "!sp", "!startpoint"],
        who: everyone,
        description:
          "Saves where you stand in the start zone as your spawn point.",
      },
      {
        name: "!deletestart",
        aliases: ["!deletesetstart", "!delss", "!delsp"],
        who: everyone,
        description: "Deletes your saved spawn point.",
      },
      {
        name: "!drawzones",
        aliases: ["!drawallzones"],
        who: everyone,
        description: "Toggles drawing all zones.",
      },
      {
        name: "!splits",
        who: everyone,
        description: "Places your own split zones, which only you see.",
      },
      {
        name: "!czone",
        aliases: ["!czones", "!customzones"],
        who: everyone,
        description:
          "Customizes how the start and end zones of each track look to you.",
      },
      {
        name: "!cszone",
        aliases: ["!cszones"],
        who: everyone,
        description: "Customizes single zones on this map.",
      },
      { name: "!beamer", who: everyone, description: "Draws beams." },
      {
        name: "sm_delzone",
        aliases: ["sm_deletezone"],
        who: { flag: "m" },
        description: "Deletes a zone.",
      },
      {
        name: "sm_deleteallzones",
        who: { flag: "m" },
        description: "Deletes all zones.",
      },
      {
        name: "sm_zoneedit",
        aliases: ["sm_editzone", "sm_modifyzone"],
        who: { flag: "m" },
        description: "Edits an existing zone.",
      },
      {
        name: "sm_hookzone",
        who: { flag: "m" },
        description:
          "Turns an existing trigger, teleporter or button into a zone.",
      },
      {
        name: "sm_tptozone",
        who: { flag: "m" },
        description: "Teleports you to a zone.",
      },
      {
        name: "sm_modifier",
        args: "<number>",
        who: { flag: "m" },
        description: "Sets how far the zone editor moves a corner each step.",
      },
      {
        name: "sm_addspawn",
        who: { flag: "m" },
        description: "Adds a custom spawn point.",
      },
      {
        name: "sm_delspawn",
        who: { flag: "m" },
        description: "Deletes a custom spawn point.",
      },
      {
        name: "sm_reloadzonesettings",
        who: { flag: "z" },
        description: "Reloads the zone settings file.",
      },
      {
        name: "sm_dumpzones",
        who: { flag: "m" },
        description: "Saves this map's zones to a JSON file.",
      },
      {
        name: "sm_editmi",
        who: { flag: "m" },
        description: "Edits this map's info and saves it to a JSON file.",
      },
    ],
  },
  {
    id: "replays",
    title: "Replays",
    plugins: ["shavit-replay-playback"],
    commands: [
      {
        name: "!replay",
        who: everyone,
        description: [
          "Opens the replay bot menu. Admins can stop the playback with ",
          { code: "sm_replay stop" },
          ".",
        ],
      },
      {
        name: "!rtime",
        args: "<time>",
        who: everyone,
        description: [
          "Jumps the replay you control to a time, as ",
          { code: "sec" },
          ", ",
          { code: "min:sec" },
          " or ",
          { code: "hour:min:sec" },
          ".",
        ],
      },
      {
        name: "!rpercent",
        args: "<0-100>",
        aliases: ["!rper"],
        who: everyone,
        description: "Jumps the replay you control to a percentage.",
      },
      {
        name: "sm_deletereplay",
        who: { flag: "m" },
        description: "Opens the replay deletion menu.",
      },
      {
        name: "sm_playreplayfile",
        args: "<path>",
        who: { flag: "m" },
        description: "Plays a replay from a file.",
      },
      {
        name: "sm_replayfileinfo",
        args: "<path>",
        who: { flag: "m" },
        description: "Prints a replay file's header to the console.",
      },
    ],
  },
  {
    id: "tas",
    title: "TAS",
    plugins: ["shavit-tas"],
    intro: [
      "In chat these take ",
      { code: "1" },
      " (on) or ",
      { code: "0" },
      " (off); with nothing, they toggle. The binds are on while the key is held.",
    ],
    commands: [
      {
        name: "!tasmenu",
        aliases: ["!tasm"],
        who: everyone,
        description: "Opens the TAS settings menu.",
      },
      {
        name: "!autostrafe",
        args: "[1|0]",
        aliases: ["!autostrafer"],
        binds: ["+autostrafe", "+autostrafer"],
        who: everyone,
        description: "Autostrafer.",
      },
      {
        name: "!autoprestrafe",
        args: "[1|0]",
        binds: ["+autoprestrafe"],
        who: everyone,
        description: "Automatic prestrafe.",
      },
      {
        name: "!autojumponstart",
        args: "[1|0]",
        binds: ["+autojumponstart"],
        who: everyone,
        description: "Jumps for you when you leave the start zone.",
      },
      {
        name: "!edgejump",
        args: "[1|0]",
        binds: ["+edgejump"],
        who: everyone,
        description: "Jumps at the edge of a ledge.",
      },
      {
        name: "!autogainbss",
        args: "[1|0]",
        binds: ["+autogainbss"],
        who: everyone,
        description: "Autogain BSS.",
      },
      {
        name: "!autocrouch",
        args: "[0|1|2]",
        who: everyone,
        description:
          "Auto crouch: off, low jump or high jump. With no value: the next one.",
      },
      {
        name: "!lowjump",
        args: "[1|0]",
        binds: ["+lowjump"],
        who: everyone,
        description: "Low jump.",
      },
      {
        name: "!highjump",
        args: "[1|0]",
        binds: ["+highjump"],
        who: everyone,
        description: "High jump.",
      },
    ],
  },
  {
    id: "misc",
    title: "Misc",
    plugins: ["shavit-misc"],
    notes: [
      [
        "Typing ",
        { code: "1r" },
        " or ",
        { code: "1b" },
        " in chat, without ",
        { code: "!" },
        ", works the same as ",
        { code: "!r" },
        " or ",
        { code: "!b" },
        ".",
      ],
    ],
    commands: [
      {
        name: "!spec",
        args: "[player]",
        aliases: ["!spectate"],
        who: everyone,
        description:
          "Moves you to spectators, watching the player if you name one.",
      },
      {
        name: "!specbot",
        who: everyone,
        description: "Spectates the replay bot.",
      },
      {
        name: "!specs",
        aliases: ["!spectators"],
        who: everyone,
        description: "Lists who is spectating.",
      },
      {
        name: "!hide",
        aliases: ["!unhide"],
        who: everyone,
        description: "Hides or shows other players.",
      },
      {
        name: "!tpto",
        args: "[player]",
        aliases: ["!goto"],
        who: everyone,
        description: "Teleports you to another player.",
      },
      {
        name: "!nc",
        aliases: ["!prac", "!practice", "!noclipme"],
        who: everyone,
        description: [
          "Toggles noclip (practice mode). ",
          { code: "sm_noclip" },
          " with no target, and the ",
          { code: "noclip" },
          " and ",
          { code: "+noclip" },
          " binds, do the same.",
        ],
      },
      { name: "!usp", who: everyone, description: "Gives you a USP." },
      { name: "!glock", who: everyone, description: "Gives you a Glock." },
      { name: "!knife", who: everyone, description: "Gives you a knife." },
      {
        name: "!autorestart",
        aliases: ["!autoreset"],
        who: everyone,
        description: "Toggles auto restart.",
      },
      {
        name: "!adverts",
        who: everyone,
        description: "Prints all the server's adverts to your chat.",
      },
      {
        name: "!toggleadverts",
        who: everyone,
        description: "Hides or shows the adverts.",
      },
      {
        name: "sm_maptimer_checkpoints",
        who: { flag: "m" },
        description: "A map fix for kz_bhop_yonkoma.",
      },
    ],
  },
  {
    id: "chat",
    title: "Chat",
    plugins: ["shavit-chat"],
    commands: [
      {
        name: "!ranks",
        aliases: ["!chatrank", "!chatranks"],
        who: everyone,
        description: "Shows the chat ranks.",
      },
      {
        name: "!cchelp",
        who: everyone,
        description: "Explains custom chat names and colors.",
      },
      {
        name: "!ccname",
        args: "<text | off>",
        who: "granted",
        description: "Sets your custom chat name.",
      },
      {
        name: "!ccmsg",
        args: "<color | off>",
        aliases: ["!ccmessage"],
        who: "granted",
        description: "Sets your chat message color.",
      },
      {
        name: "sm_cclist",
        who: { flag: "j" },
        description: "Prints every online player's custom chat settings.",
      },
      {
        name: "sm_ccadd",
        args: "<steamid3>",
        who: { flag: "z" },
        description: [
          "Gives a player access to ",
          { code: "!ccname" },
          " and ",
          { code: "!ccmsg" },
          ".",
        ],
      },
      {
        name: "sm_ccdelete",
        args: "<steamid3>",
        who: { flag: "z" },
        description: "Takes that access away.",
      },
      {
        name: "sm_reloadchatranks",
        who: { flag: "z" },
        description: "Reloads the chat ranks config.",
      },
    ],
  },
  {
    id: "map-votes",
    title: "Map votes",
    plugins: ["shavit-mapchooser", "shavit-timelimit"],
    notes: [
      [
        { code: "rtv" },
        ", ",
        { code: "rockthevote" },
        ", ",
        { code: "unrtv" },
        ", ",
        { code: "nominate" },
        ", ",
        { code: "unnominate" },
        ", ",
        { code: "nextmap" },
        " and ",
        { code: "timeleft" },
        " also work as plain words in chat, without ",
        { code: "!" },
        ".",
      ],
    ],
    commands: [
      {
        name: "!rtv",
        who: everyone,
        description: "Votes to change the map (rock the vote).",
      },
      { name: "!unrtv", who: everyone, description: "Takes back your rtv." },
      {
        name: "!nominate",
        args: "[map]",
        who: everyone,
        description: "Nominates a map for the map vote.",
      },
      {
        name: "!unnominate",
        who: everyone,
        description: "Takes back your nomination.",
      },
      {
        name: "!nomlist",
        aliases: ["!nominations", "!nominatedmaps"],
        who: everyone,
        description: "Shows the nominated maps.",
      },
      {
        name: "sm_forcemapvote",
        who: { flag: "g" },
        description: "Starts the end-of-map vote now.",
      },
      {
        name: "sm_reloadmaplist",
        who: { flag: "g" },
        description: "Reloads the map list.",
      },
      {
        name: "sm_reloadmap",
        aliases: ["sm_restartmap", "sm_mapreload", "sm_maprestart"],
        who: { flag: "g" },
        description: "Reloads the current map.",
      },
      {
        name: "sm_loadunzonedmap",
        who: { flag: "g" },
        description:
          "Changes to the next map in the maps folder that has no zones.",
      },
      {
        name: "sm_extend",
        aliases: ["sm_extendmap"],
        who: { flag: "g" },
        description: "Extends the map's time.",
      },
      {
        name: "sm_smcdebug",
        who: { flag: "m" },
        description: "Prints mapchooser debug info.",
      },
    ],
  },
  {
    id: "sourcejump",
    title: "SourceJump",
    plugins: ["sourcejump"],
    commands: [
      {
        name: "!discord",
        who: everyone,
        description: "Prints the Discord invite.",
      },
      {
        name: "sm_sj_status",
        who: everyone,
        description:
          "Shows the server's SourceJump state: version, ruleset, and whether it's compliant and why.",
      },
      {
        name: "sm_sj_reload",
        who: { flag: "m" },
        description: "Fetches the ruleset again and checks the server again.",
      },
      {
        name: "sm_sj_update",
        who: { flag: "m" },
        description: "Checks for a SourceJump release now.",
      },
      {
        name: "sm_sj_restore",
        args: "[plugin]",
        who: { flag: "m" },
        description:
          "Puts back a plugin SourceJump disabled. With no argument, lists them.",
      },
      {
        name: "sm_sj_ac",
        args: "<player>",
        who: { flag: "d" },
        description: "Shows a player's anti-cheat state.",
      },
      {
        name: "sm_sj_vreplay",
        args: "<file> [mode] [timescale] [max ticks]",
        who: { flag: "z" },
        description: [
          "Replay verifier: plays a replay from ",
          { code: "data/sourcejump/verify" },
          " and reports where it leaves the standard.",
        ],
      },
      {
        name: "sm_sj_vbatch",
        args: "<file> <count> <stagger ticks> [timescale]",
        who: { flag: "z" },
        description:
          "Replay verifier: plays one replay on several bots at once.",
      },
      {
        name: "sm_sj_vstop",
        who: { flag: "z" },
        description: "Stops the replay verifier.",
      },
    ],
  },
];

/**
 * The style commands in shavit's default `shavit-styles.cfg`. Each server sets up its own styles, so its commands
 * can differ; which styles SourceJump ranks is the ruleset's, not this list's.
 */
export const defaultStyleCommands: readonly StyleCommands[] = [
  { style: "Normal", commands: ["!n", "!nm", "!normal"] },
  { style: "Sideways", commands: ["!sw", "!side", "!sideways"] },
  { style: "W-Only", commands: ["!w", "!wonly"] },
  { style: "Scroll", commands: ["!le", "!legit", "!scr", "!scroll"] },
  { style: "400 Velocity", commands: ["!400", "!400vel", "!vel"] },
  { style: "Half-Sideways", commands: ["!hsw", "!halfside", "!halfsideways"] },
  { style: "A/D-Only", commands: ["!a", "!aonly", "!ad", "!d", "!donly"] },
  { style: "Segmented", commands: ["!sr", "!seg", "!segment", "!segmented"] },
  { style: "Low Gravity", commands: ["!lg", "!lowgrav"] },
  { style: "Slow Motion", commands: ["!slow", "!slowmo"] },
  { style: "TAS", commands: ["!tas"] },
];

/** Whether only admins may use it; everything else is a player command. */
export function isAdminCommand(command: Command): boolean {
  return typeof command.who === "object";
}

/**
 * A name as the search compares it: without the `!`, `/` or `sm_` it's typed with, so "restart", "!restart"
 * and "sm_restart" all find `!r` by its alias. Lowercase, as the game accepts any case.
 */
function searchable(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^[!/]|^sm_/, "");
}

/** Whether the command's name, an alias or a bind contains the query. An empty query matches everything. */
export function commandMatches(command: Command, query: string): boolean {
  const wanted = searchable(query);
  if (wanted === "") return true;
  return [command.name, ...(command.aliases ?? []), ...(command.binds ?? [])]
    .map(searchable)
    .some((name) => name.includes(wanted));
}

/** Whether a style's name or one of its commands contains the query. */
export function styleMatches(style: StyleCommands, query: string): boolean {
  const wanted = searchable(query);
  if (wanted === "") return true;
  return (
    style.style.toLowerCase().includes(wanted) ||
    style.commands.map(searchable).some((name) => name.includes(wanted))
  );
}
