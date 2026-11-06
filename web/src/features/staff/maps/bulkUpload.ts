// Sorts the files staff drop on the bulk upload into one entry per map: a file `sj-pack` already packed
// (`{map}.viewer.br`), or a map to pack in the page (`{map}.bsp`, `{map}.bsp.bz2`), and the files it can't use.

import { MAP_NAME } from "../../maps/mapName";

/** The packer's limit on a map before packing (`viewer_pack::MAX_MAP_BYTES`). */
export const MAX_MAP_BYTES = 1024 * 1024 * 1024;
/** The largest packed file the API takes (`viewer_pack::MAX_PACKED_BYTES`). */
export const MAX_PACKED_BYTES = 256 * 1024 * 1024;

export type MapFile = {
  map: string;
  file: File;
  /** Already packed by `sj-pack`, or a map the page packs first. */
  packed: boolean;
};

export type Refused = { file: string; reason: string };

/** The kind of each file name, or null for files that aren't maps (skipped without a word). */
function kind(
  name: string,
): { map: string; packed: boolean; compressed: boolean } | null {
  const lower = name.toLowerCase();
  for (const [suffix, packed, compressed] of [
    [".viewer.br", true, false],
    [".bsp.bz2", false, true],
    [".bsp", false, false],
  ] as const) {
    if (lower.endsWith(suffix)) {
      return { map: lower.slice(0, -suffix.length), packed, compressed };
    }
  }
  return null;
}

/**
 * One file per map, by name: a packed file over the map itself, since packing is the slow part, and a `.bsp`
 * over its `.bsp.bz2`, which needs no unpacking.
 */
export function sortFiles(files: readonly File[]): {
  maps: MapFile[];
  refused: Refused[];
} {
  const chosen = new Map<string, { entry: MapFile; rank: number }>();
  const refused: Refused[] = [];
  for (const file of files) {
    const found = kind(file.name);
    if (!found) continue;
    if (!MAP_NAME.test(found.map)) {
      refused.push({
        file: file.name,
        reason: "not a map name SourceJump accepts",
      });
      continue;
    }
    const limit = found.packed ? MAX_PACKED_BYTES : MAX_MAP_BYTES;
    if (file.size > limit) {
      refused.push({
        file: file.name,
        reason: `over ${limit / (1024 * 1024)} MB`,
      });
      continue;
    }
    const rank = found.packed ? 0 : found.compressed ? 2 : 1;
    const held = chosen.get(found.map);
    if (!held || rank < held.rank) {
      chosen.set(found.map, {
        entry: { map: found.map, file, packed: found.packed },
        rank,
      });
    }
  }
  const maps = [...chosen.values()]
    .map(({ entry }) => entry)
    .sort((a, b) => a.map.localeCompare(b.map));
  return { maps, refused };
}

/**
 * Every file in what was dropped, folders included: dropping the folder `sj-pack` ran in brings its maps and
 * its `packed` folder together. Browsers hand folders over as entries to walk, not as files.
 */
export async function droppedFiles(
  items: DataTransferItemList,
): Promise<File[]> {
  const entries = [...items]
    .map((item) => item.webkitGetAsEntry())
    .filter((entry) => entry !== null);
  const files: File[] = [];
  async function walk(entry: FileSystemEntry, depth: number): Promise<void> {
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        ),
      );
    } else if (entry.isDirectory && depth < 3) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries gives a batch at a time, and an empty one at the end.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, depth + 1);
      }
    }
  }
  for (const entry of entries) await walk(entry, 0);
  return files;
}
