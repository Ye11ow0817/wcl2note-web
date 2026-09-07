export type EventType = "Casts" | "Buffs" | "Debuffs";
export type Side = "friendly" | "enemy";
export interface Actor {
  id: number;
  name: string;
  type?: string | null;
  subType?: string | null;
  petOwner?: number | null;
}
export interface Ability {
  gameID: number;
  name: string;
  icon?: string | null;
  type?: string | number | null;
}
export interface FightActor {
  id: number;
  instanceCount?: number;
  petOwner?: number | null;
}
export interface Fight {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  encounterID?: number;
  difficulty?: number;
  kill?: boolean;
  keystoneLevel?: number;
  keystoneTime?: number;
  dungeonPulls?: Fight[];
  phaseTransitions?: { id: number; startTime: number }[];
  friendlyPlayers?: number[];
  enemyPlayers?: number[];
  friendlyNPCs?: FightActor[];
  friendlyPets?: FightActor[];
  enemyNPCs?: FightActor[];
  enemyPets?: FightActor[];
}
export interface Report {
  startTime: number;
  fights?: Fight[];
  phases?: { encounterID: number; phases: { id: number; name: string }[] }[];
  masterData?: { actors: Actor[]; abilities: Ability[] };
  events?: { data: RawEvent[]; nextPageTimestamp?: number | null };
}
export interface RawEvent {
  type?: string;
  timestamp: number;
  abilityGameID: number;
  sourceID?: number;
  targetID?: number;
  sourceInstance?: number;
  sourceInstanceID?: number;
  targetInstance?: number;
  targetInstanceID?: number;
  sourceIsFriendly?: boolean;
  targetIsFriendly?: boolean;
}
export interface Segment {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  relative: boolean;
}
export interface TimelineEvent {
  timestamp: number;
  time: number;
  actor: Actor;
  side: Side;
  instance?: number;
  ability: Ability;
  eventType: EventType;
}
export interface Group {
  key: string;
  sourceKey: string;
  actor: Actor;
  baseName: string;
  side: Side;
  instance?: number;
  ability: Ability;
  eventType: EventType;
  events: TimelineEvent[];
}
export interface SourceNode {
  key: string;
  name: string;
  matches: string[];
  children: SourceNode[];
  player: boolean;
}
export interface Options {
  icon: boolean;
  friendly: boolean;
  enemy: boolean;
  simplify: boolean;
}
export const defaults: Options = {
  icon: false,
  friendly: true,
  enemy: false,
  simplify: true,
};
export const compare = (a: string, b: string) => a.localeCompare(b, "zh-CN");
export const sourceKey = (side: Side, id: number, instance?: number) =>
  `${side}:${id}:${instance ?? ""}`;
export const filterKey = (side: Side, actor: Actor, instance?: number) =>
  sourceKey(
    side,
    actor.id,
    actor.type?.toLowerCase() === "player" ? undefined : (instance ?? 1),
  );
export const selectionKey = (
  type: EventType,
  side: Side,
  id: number,
  ability: number,
) => `${type}:${side}:${id}:${ability}`;
export const duration = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
