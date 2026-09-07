import {
  compare,
  filterKey,
  selectionKey,
  sourceKey,
  type Actor,
  type EventType,
  type Fight,
  type Group,
  type RawEvent,
  type Report,
  type Segment,
  type Side,
  type SourceNode,
  type TimelineEvent,
} from "./model";
export function actorCatalog(report: Report, fight: Fight) {
  const master = new Map(
    (report.masterData?.actors ?? []).map((a) => [a.id, a]),
  );
  const entries: { actor: Actor; side: Side; instance?: number }[] = [];
  for (const side of ["friendly", "enemy"] as const) {
    for (const id of fight[
      side === "friendly" ? "friendlyPlayers" : "enemyPlayers"
    ] ?? [])
      entries.push({
        actor: master.get(id) ?? { id, name: `未知角色 ${id}` },
        side,
      });
    for (const a of [
      ...(fight[side === "friendly" ? "friendlyNPCs" : "enemyNPCs"] ?? []),
      ...(fight[side === "friendly" ? "friendlyPets" : "enemyPets"] ?? []),
    ]) {
      const actor = master.get(a.id) ?? { id: a.id, name: `未知角色 ${a.id}` };
      for (
        let instance = 1;
        instance <= Math.max(1, a.instanceCount ?? 1);
        instance++
      )
        entries.push({
          actor: { ...actor, petOwner: actor.petOwner ?? a.petOwner },
          side,
          instance,
        });
    }
  }
  return entries.map((e) => ({
    ...e,
    actor: {
      ...e.actor,
      petOwner:
        e.actor.petOwner ??
        entries.find(
          (a) =>
            a.side === e.side &&
            a.actor.id === e.actor.id &&
            a.actor.petOwner != null,
        )?.actor.petOwner,
    },
  }));
}
export function mapEvents(
  raw: RawEvent[],
  type: EventType,
  report: Report,
  fight: Fight,
  queried: Side,
): TimelineEvent[] {
  const actors = new Map(
      (report.masterData?.actors ?? []).map((a) => [a.id, a]),
    ),
    abilities = new Map(
      (report.masterData?.abilities ?? []).map((a) => [a.gameID, a]),
    );
  const catalog = actorCatalog(report, fight),
    aura = type !== "Casts";
  return raw.flatMap((e) => {
    if (
      !(type === "Casts"
        ? e.type == null || e.type.toLowerCase() === "cast"
        : e.type?.toLowerCase() ===
          (type === "Buffs" ? "applybuff" : "applydebuff"))
    )
      return [];
    if (!Number.isSafeInteger(e.abilityGameID) || !Number.isFinite(e.timestamp))
      return [];
    const id = aura ? (e.targetID ?? e.sourceID) : e.sourceID;
    if (id === undefined) return [];
    const actor = actors.get(id) ?? { id, name: `未知角色 ${id}` };
    const known =
      catalog.find((a) => a.actor.id === id && a.side === "friendly") ??
      catalog.find((a) => a.actor.id === id);
    const friendly = aura ? e.targetIsFriendly : e.sourceIsFriendly;
    const side =
      known?.side ??
      (actor.type?.toLowerCase() === "player"
        ? "friendly"
        : typeof friendly === "boolean"
          ? friendly
            ? "friendly"
            : "enemy"
          : queried);
    return [
      {
        timestamp: e.timestamp,
        time: Math.max(0, e.timestamp - fight.startTime),
        actor,
        side,
        instance: aura
          ? (e.targetInstance ?? e.targetInstanceID)
          : (e.sourceInstance ?? e.sourceInstanceID),
        ability: abilities.get(e.abilityGameID) ?? {
          gameID: e.abilityGameID,
          name: `未知技能 ${e.abilityGameID}`,
        },
        eventType: type,
      },
    ];
  });
}
export function groupEvents(
  events: TimelineEvent[],
  segment: Segment,
  fight: Fight,
): Group[] {
  const start = Math.max(segment.startTime, fight.startTime),
    end = Math.min(segment.endTime, fight.endTime);
  if (end <= start) return [];
  const filtered = events
    .filter((e) => e.timestamp >= start && e.timestamp <= end)
    .map((e) => ({
      ...e,
      time:
        e.timestamp - (segment.relative ? segment.startTime : fight.startTime),
    }));
  const identities = new Map<string, TimelineEvent>();
  for (const e of filtered) {
    const k = sourceKey(e.side, e.actor.id, e.instance);
    if (!identities.has(k)) identities.set(k, e);
  }
  const names = new Map<string, string>();
  for (const e of identities.values()) {
    const same = [...identities.values()]
      .filter((x) => x.side === e.side && x.actor.name === e.actor.name)
      .sort(
        (a, b) =>
          (a.instance ?? 2147483647) - (b.instance ?? 2147483647) ||
          a.actor.id - b.actor.id,
      );
    const useInstances =
      same.every((a) => (a.instance ?? 0) > 0) &&
      new Set(same.map((a) => a.instance)).size === same.length;
    same.forEach((a, i) =>
      names.set(
        sourceKey(a.side, a.actor.id, a.instance),
        `${a.actor.name}${same.length > 1 ? ` ${useInstances ? a.instance : i + 1}` : ""}`,
      ),
    );
  }
  const groups = new Map<string, Group>();
  for (const e of filtered) {
    const sk = sourceKey(e.side, e.actor.id, e.instance),
      k = `${e.eventType}:${sk}:${e.ability.gameID}:${e.ability.name}:${e.ability.icon ?? ""}:${e.ability.type ?? ""}`;
    if (!groups.has(k))
      groups.set(k, {
        key: selectionKey(e.eventType, e.side, e.actor.id, e.ability.gameID),
        sourceKey: filterKey(e.side, e.actor, e.instance),
        actor: { ...e.actor, name: names.get(sk)! },
        baseName: e.actor.name,
        side: e.side,
        instance: e.instance,
        ability: e.ability,
        eventType: e.eventType,
        events: [],
      });
    groups.get(k)!.events.push(e);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, events: g.events.sort((a, b) => a.time - b.time) }))
    .sort(
      (a, b) =>
        (a.side === "friendly" ? 0 : 1) - (b.side === "friendly" ? 0 : 1) ||
        compare(a.actor.name, b.actor.name) ||
        b.events.length - a.events.length ||
        compare(a.ability.name, b.ability.name),
    );
}
export function sourceTree(
  groups: Group[],
  report: Report,
  fight: Fight,
  side: Side,
): SourceNode[] {
  const catalog = actorCatalog(report, fight).filter((e) => e.side === side);
  const normalized = [
    ...new Map(
      groups
        .filter((g) => g.side === side)
        .map((g) => {
          const owned = catalog.filter(
            (e) => e.actor.name === g.baseName && e.actor.petOwner != null,
          );
          const fallback =
            new Set(owned.map((e) => e.actor.petOwner)).size === 1
              ? owned[0]
              : undefined;
          const c =
            catalog.find(
              (e) => filterKey(side, e.actor, e.instance) === g.sourceKey,
            ) ??
            catalog.find((e) => e.actor.id === g.actor.id) ??
            fallback;
          return [
            g.sourceKey,
            {
              ...g,
              actor: { ...g.actor, ...c?.actor, id: g.actor.id },
              baseName: c?.actor.name ?? g.baseName,
            },
          ];
        }),
    ).values(),
  ];
  const node = (key: string, name: string, members: Group[]): SourceNode => {
    const ordered = [...members].sort(
        (a, b) =>
          (a.instance ?? 2147483647) - (b.instance ?? 2147483647) ||
          a.actor.id - b.actor.id,
      ),
      useIds =
        ordered.every((a) => (a.instance ?? 0) > 0) &&
        new Set(ordered.map((a) => a.instance)).size === ordered.length;
    return {
      key,
      name,
      matches: members.map((g) => g.sourceKey),
      player: members.some((g) => g.actor.type?.toLowerCase() === "player"),
      children:
        members.length > 1
          ? ordered.map((g, i) => ({
              key: `instance:${g.sourceKey}`,
              name: String(useIds ? g.instance : i + 1),
              matches: [g.sourceKey],
              children: [],
              player: false,
            }))
          : [],
    };
  };
  const byName = (members: Group[], prefix: string) =>
    [...new Set(members.map((g) => g.baseName))]
      .map((name) =>
        node(
          `${prefix}:${side}:${name}`,
          name,
          members.filter((g) => g.baseName === name),
        ),
      )
      .sort(
        (a, b) =>
          Number(b.player) - Number(a.player) || compare(a.name, b.name),
      );
  const roots: SourceNode[] = [],
    consumed = new Set<string>();
  for (const owner of new Set(
    normalized
      .map((g) => g.actor.petOwner)
      .filter((x): x is number => x != null),
  )) {
    const pets = normalized.filter((g) => g.actor.petOwner === owner),
      own = normalized.filter(
        (g) => g.actor.id === owner && g.actor.petOwner == null,
      );
    [...pets, ...own].forEach((g) => consumed.add(g.sourceKey));
    const actor = report.masterData?.actors.find((a) => a.id === owner);
    const children = [
      ...node("owner-instances", "", own).children,
      ...byName(pets, `pet:${owner}`),
    ];
    roots.push({
      key: `owner:${side}:${owner}`,
      name: own[0]?.baseName ?? actor?.name ?? `未知角色 ${owner}`,
      matches: own.length
        ? own.map((g) => g.sourceKey)
        : children.flatMap((n) => n.matches),
      children,
      player:
        actor?.type?.toLowerCase() === "player" ||
        own.some((g) => g.actor.type?.toLowerCase() === "player"),
    });
  }
  return [
    ...roots,
    ...byName(
      normalized.filter((g) => !consumed.has(g.sourceKey)),
      "actor",
    ),
  ].sort(
    (a, b) => Number(b.player) - Number(a.player) || compare(a.name, b.name),
  );
}
export function visibleGroups(
  groups: Group[],
  side: Side,
  filter: SourceNode | undefined,
  report: Report,
  fight: Fight,
): Group[] {
  const catalog = actorCatalog(report, fight);
  const filtered = groups
    .filter(
      (g) =>
        g.side === side && (!filter || filter.matches.includes(g.sourceKey)),
    )
    .filter(
      (g) =>
        side === "enemy" ||
        filter ||
        !(
          g.actor.petOwner != null ||
          g.actor.type?.toLowerCase() === "pet" ||
          catalog.some(
            (a) =>
              a.side === "friendly" &&
              a.actor.id === g.actor.id &&
              a.actor.petOwner != null,
          )
        ),
    );
  if (
    (side === "enemy" && !filter) ||
    (filter && !filter.key.startsWith("instance:") && filter.matches.length > 1)
  ) {
    const merged = new Map<string, Group>();
    for (const g of filtered) {
      if (!merged.has(g.key))
        merged.set(g.key, {
          ...g,
          actor: { ...g.actor, name: g.baseName },
          events: [],
        });
      merged.get(g.key)!.events.push(...g.events);
    }
    return [...merged.values()].sort(
      (a, b) =>
        (!filter
          ? compare(a.baseName, b.baseName) || a.actor.id - b.actor.id
          : 0) ||
        b.events.length - a.events.length ||
        compare(a.ability.name, b.ability.name),
    );
  }
  return side === "friendly" && !filter
    ? [...filtered].sort(
        (a, b) =>
          Number(b.actor.type?.toLowerCase() === "player") -
            Number(a.actor.type?.toLowerCase() === "player") ||
          compare(a.baseName, b.baseName) ||
          b.events.length - a.events.length ||
          compare(a.ability.name, b.ability.name),
      )
    : filtered;
}
