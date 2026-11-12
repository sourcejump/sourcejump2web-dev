// The Commands page's data and search: names found by alias and however they're typed, and data the page can render.
import { describe, expect, it } from "vitest";
import {
  type Command,
  commandGroups,
  commandMatches,
  defaultStyleCommands,
  isAdminCommand,
  styleMatches,
} from "./commands";

const restart: Command = {
  name: "!r",
  aliases: ["!restart", "!start"],
  who: "everyone",
  description: "Restarts your timer.",
};

describe("commandMatches", () => {
  it("finds a command by its name or an alias, however it's typed", () => {
    for (const query of ["r", "!r", "/R", "sm_restart", "RESTART", " start "]) {
      expect(commandMatches(restart, query), query).toBe(true);
    }
    expect(commandMatches(restart, "stop")).toBe(false);
  });

  it("matches everything with no query", () => {
    expect(commandMatches(restart, "")).toBe(true);
    expect(commandMatches(restart, "  ")).toBe(true);
  });

  it("finds a TAS command by its bind", () => {
    const autostrafe = commandGroups
      .find((group) => group.id === "tas")
      ?.commands.find((command) => command.name === "!autostrafe");
    expect(autostrafe && commandMatches(autostrafe, "+autostrafer")).toBe(true);
  });
});

describe("styleMatches", () => {
  it("finds a default style by its name or a command", () => {
    const segmented = defaultStyleCommands.find(
      (style) => style.style === "Segmented",
    );
    expect(segmented && styleMatches(segmented, "seg")).toBe(true);
    expect(segmented && styleMatches(segmented, "!sr")).toBe(true);
    expect(segmented && styleMatches(segmented, "tas")).toBe(false);
  });
});

describe("isAdminCommand", () => {
  it("counts only commands that need an admin flag, not ones players are given access to", () => {
    expect(isAdminCommand(restart)).toBe(false);
    expect(isAdminCommand({ ...restart, who: "granted" })).toBe(false);
    expect(isAdminCommand({ ...restart, who: { flag: "z" } })).toBe(true);
  });
});

describe("commandGroups", () => {
  it("has a unique anchor for every group, and no command twice in a group", () => {
    const ids = commandGroups.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of commandGroups) {
      const names = group.commands.map((command) => command.name);
      expect(new Set(names).size, group.id).toBe(names.length);
    }
  });
});
