import { useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  FileText,
  LoaderCircle,
  Settings2,
  X,
} from "lucide-react";
import { allEvents, query, session, type Mode } from "../infrastructure/client";
import {
  defaults,
  duration,
  type EventType,
  type Fight,
  type Options,
  type Side,
  type SourceNode,
} from "../domain/model";
import {
  filename,
  initialSegment,
  parseReport,
  segments,
  type ReportRef,
} from "../domain/report";
import { groupEvents, sourceTree, visibleGroups } from "../domain/group";
import { formatNote } from "../domain/format";
const eventTypes: EventType[] = ["Casts", "Buffs", "Debuffs"];
const eventLabels = { Casts: "施法", Buffs: "Buff", Debuffs: "Debuff" };
function Tree({
  nodes,
  selected,
  onSelect,
}: {
  nodes: SourceNode[];
  selected: string;
  onSelect: (n: SourceNode) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.key}>
          <button
            className={selected === n.key ? "source active" : "source"}
            onClick={() => onSelect(n)}
            title={n.name}
          >
            {n.children.length > 0 && <ChevronDown size={13} />}
            <span>{n.name}</span>
          </button>
          {n.children.length > 0 && (
            <Tree nodes={n.children} selected={selected} onSelect={onSelect} />
          )}
        </li>
      ))}
    </ul>
  );
}
function findNode(nodes: SourceNode[], key: string): SourceNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    const found = findNode(n.children, key);
    if (found) return found;
  }
}
export function App() {
  const cache = useQueryClient(),
    [input, setInput] = useState(""),
    [ref, setRef] = useState<ReportRef>(),
    [revision, setRevision] = useState(0),
    [fight, setFight] = useState<Fight>(),
    [segmentId, setSegmentId] = useState<string>(),
    [type, setType] = useState<EventType>("Casts"),
    [side, setSide] = useState<Side>("enemy"),
    [source, setSource] = useState(""),
    [selected, setSelected] = useState(new Set<string>()),
    [options, setOptions] = useState<Options>(defaults),
    [settings, setSettings] = useState(false),
    [mode, setMode] = useState<Mode>("shared"),
    [identity, setIdentity] = useState(0),
    [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [message, setMessage] = useState(""),
    [localError, setLocalError] = useState("");
  const authVersion = useRef(0),
    authAbort = useRef<AbortController | undefined>(undefined),
    previousSource = useRef<SourceNode | undefined>(undefined);
  const fightsQuery = useQuery({
    queryKey: ["fights", identity, ref?.code, revision],
    enabled: !!ref,
    queryFn: ({ signal }) =>
      query(
        { operation: "reportFights", variables: { reportCode: ref!.code } },
        mode,
        signal,
      ),
  });
  const fights = fightsQuery.data?.fights ?? [];
  const initialFight =
    ref?.fight !== undefined
      ? fights.find((f) => f.id === ref.fight)
      : ref?.last
        ? fights.at(-1)
        : undefined;
  const currentFight = fight ?? initialFight;
  const segmentsQuery = useQuery({
    queryKey: ["segments", identity, ref?.code, currentFight?.id],
    enabled: !!currentFight && !!ref,
    queryFn: ({ signal }) =>
      query(
        {
          operation: "fightSegments",
          variables: { reportCode: ref!.code, fightId: currentFight!.id },
        },
        mode,
        signal,
      ),
  });
  const detailedFight = segmentsQuery.data?.fights?.find(
    (f) => f.id === currentFight?.id,
  );
  const availableSegments = useMemo(
    () =>
      detailedFight && segmentsQuery.data
        ? segments({ ...currentFight, ...detailedFight }, segmentsQuery.data)
        : [],
    [currentFight, detailedFight, segmentsQuery.data],
  );
  const segment =
    availableSegments.find((s) => s.id === segmentId) ??
    (ref && !fight
      ? initialSegment(availableSegments, ref)
      : availableSegments[0]);
  const contextQuery = useQuery({
    queryKey: ["context", identity, ref?.code, currentFight?.id],
    enabled: !!currentFight && !!segment,
    queryFn: ({ signal }) =>
      query(
        {
          operation: "fightContext",
          variables: { reportCode: ref!.code, fightId: currentFight!.id },
        },
        mode,
        signal,
      ),
  });
  const required = eventTypes.filter(
    (t) => t === type || [...selected].some((k) => k.startsWith(`${t}:`)),
  );
  const eventQueries = useQueries({
    queries: required.map((t) => ({
      queryKey: ["events", identity, ref?.code, currentFight?.id, t],
      enabled: !!contextQuery.data && !!segment,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        allEvents(
          ref!.code,
          currentFight!,
          contextQuery.data!,
          t,
          mode,
          signal,
        ),
    })),
  });
  const allGroups = useMemo(
    () =>
      segment && currentFight
        ? eventQueries.flatMap((q) =>
            groupEvents(q.data ?? [], segment, currentFight),
          )
        : [],
    [
      eventQueries[0]?.data,
      eventQueries[1]?.data,
      eventQueries[2]?.data,
      segment,
      currentFight,
    ],
  );
  const activeGroups = allGroups.filter((g) => g.eventType === type);
  const nodes =
    contextQuery.data && currentFight
      ? sourceTree(activeGroups, contextQuery.data, currentFight, side)
      : [];
  const flattened = (items: SourceNode[]): SourceNode[] =>
    items.flatMap((n) => [n, ...flattened(n.children)]);
  const filter = source
    ? (findNode(nodes, source) ??
      flattened(nodes).find((n) =>
        n.matches.some((k) => previousSource.current?.matches.includes(k)),
      ) ??
      flattened(nodes).find((n) => n.name === previousSource.current?.name))
    : undefined;
  const shown =
    contextQuery.data && currentFight
      ? visibleGroups(
          activeGroups,
          side,
          filter,
          contextQuery.data,
          currentFight,
        )
      : [];
  const error =
    localError ||
    [fightsQuery, segmentsQuery, contextQuery, ...eventQueries].find(
      (q) => q.error,
    )?.error?.message;
  const loading = [
    fightsQuery,
    segmentsQuery,
    contextQuery,
    ...eventQueries,
  ].some((q) => q.isFetching);
  const selectedGroups = allGroups.filter((g) => selected.has(g.key));
  const title = currentFight
    ? `${currentFight.name}${segment && segment.id !== "full" ? ` - ${segment.name}` : ""}`
    : "";
  const note =
    selectedGroups.length && !loading && !error
      ? formatNote(title, selectedGroups, options)
      : "";
  function resetFight() {
    setFight(undefined);
    setSegmentId(undefined);
    setSelected(new Set());
    setType("Casts");
    setSide("enemy");
    setSource("");
    setMessage("");
    setLocalError("");
  }
  function loadReport() {
    try {
      const parsed = parseReport(input);
      void cache.cancelQueries();
      resetFight();
      setRef(parsed);
      setRevision((v) => v + 1);
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  function chooseFight(f: Fight) {
    void cache.cancelQueries({ predicate: (q) => q.queryKey[0] !== "fights" });
    resetFight();
    setFight(f);
  }
  async function authenticate(shared = false) {
    const version = ++authVersion.current;
    authAbort.current?.abort();
    const abort = new AbortController();
    authAbort.current = abort;
    setAuthBusy(true);
    setLocalError("");
    try {
      const result = await session(
        shared ? "" : clientId,
        shared ? "" : secret,
        abort.signal,
      );
      if (version !== authVersion.current) return;
      await cache.cancelQueries();
      cache.clear();
      setMode(result.mode);
      setIdentity((v) => v + 1);
      setRef(undefined);
      resetFight();
      setSecret("");
      if (shared) setClientId("");
      setMessage(
        result.mode === "custom"
          ? "自定义凭据认证成功，会话最长保留 1 小时。"
          : "已使用默认共享凭据。",
      );
    } catch (e) {
      if (!abort.signal.aborted) setLocalError((e as Error).message);
    } finally {
      if (version === authVersion.current) setAuthBusy(false);
    }
  }
  function toggle(key: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(note);
      setMessage("已复制 MRT 文本");
    } catch {
      setMessage("剪贴板不可用，请在预览框中全选并手动复制。");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([note], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename(`${title}.txt`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("已下载 UTF-8 文本");
  }
  function retry() {
    setLocalError("");
    void cache.invalidateQueries({
      predicate: (q) => q.state.status === "error",
    });
  }
  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="/" aria-label="wcl2note 首页">
          <span className="brand-icon">
            <Activity size={21} />
          </span>
          <b>
            wcl2<span>note</span>
          </b>
        </a>
        <div className="header-right">
          <span className="mode">
            <i />
            {mode === "shared" ? "共享凭据" : "自定义凭据"}
          </span>
          <button
            className={settings ? "icon-button active" : "icon-button"}
            onClick={() => setSettings(!settings)}
            aria-label="设置"
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">WARCRAFT LOGS → MRT</div>
            <h1>把战斗记录，变成团队笔记。</h1>
            <p>选择战斗与技能，生成可直接使用的 MRT 时间轴。</p>
          </div>
          <span className="version">wcl2note / 01</span>
        </div>
        {settings && (
          <section className="settings">
            <div className="section-heading">
              <h2>Warcraft Logs 凭据</h2>
              <button
                className="icon-button"
                onClick={() => setSettings(false)}
                aria-label="关闭设置"
              >
                <X size={16} />
              </button>
            </div>
            <p>
              默认模式访问公开报告。自定义凭据由本网站代为访问 WCL；Secret
              仅用于本次认证，不永久保存。刷新页面后回到默认模式。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void authenticate();
              }}
            >
              <label>
                Client ID
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  disabled={authBusy}
                />
              </label>
              <label>
                Client Secret
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                  disabled={authBusy}
                />
              </label>
              <button className="primary" disabled={authBusy}>
                {authBusy ? "正在认证…" : "保存并认证"}
              </button>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void authenticate(true)}
              >
                恢复默认
              </button>
            </form>
            <a
              href="https://cn.warcraftlogs.com/api/clients/"
              target="_blank"
              rel="noreferrer"
            >
              申请 WCL API 凭据 ↗
            </a>
          </section>
        )}
        <form
          className="report-input"
          onSubmit={(e) => {
            e.preventDefault();
            loadReport();
          }}
        >
          <FileText size={20} />
          <input
            aria-label="报告链接"
            placeholder="粘贴 Warcraft Logs 报告链接或报告编号"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={authBusy}
          />
          <button className="primary" disabled={authBusy}>
            加载报告
            <ArrowRight size={16} />
          </button>
        </form>
        {error && (
          <div role="alert" className="error">
            <span>{error}</span>
            <button onClick={retry}>重试</button>
          </div>
        )}
        <div className="workspace">
          <section className="panel fights">
            <div className="panel-heading">
              <h2>
                <em>01</em>战斗
              </h2>
              <span className="count">{fights.length}</span>
            </div>
            <div className="panel-body">
              {fights.length ? (
                fights.map((f) => (
                  <button
                    className={`fight-card ${currentFight?.id === f.id ? "active" : ""}`}
                    key={f.id}
                    onClick={() => chooseFight(f)}
                  >
                    <div>
                      <strong>{f.name}</strong>
                      {f.kill && <Check size={14} className="success" />}
                    </div>
                    <small>
                      #{f.id} ·{" "}
                      {f.keystoneLevel ? `+${f.keystoneLevel} · ` : ""}
                      {duration(f.endTime - f.startTime)} ·{" "}
                      {f.kill ? "击杀" : "未击杀"}
                    </small>
                  </button>
                ))
              ) : (
                <div className="empty">
                  <FileText />
                  <p>
                    {fightsQuery.isFetching
                      ? "正在读取报告…"
                      : ref
                        ? "报告中没有战斗"
                        : "加载报告后选择战斗"}
                  </p>
                </div>
              )}
            </div>
            <div className="panel-heading segment-heading">
              <h2>
                <em>02</em>Pull / 阶段
              </h2>
            </div>
            <div className="segment-list">
              {availableSegments.length ? (
                availableSegments.map((s, i) => (
                  <button
                    key={`${s.id}:${i}`}
                    className={segment === s ? "segment active" : "segment"}
                    onClick={() => {
                      setSegmentId(s.id);
                      setMessage("");
                    }}
                  >
                    <span>{s.name}</span>
                    <small>{duration(s.endTime - s.startTime)}</small>
                  </button>
                ))
              ) : (
                <p className="hint">选择战斗后显示</p>
              )}
            </div>
          </section>
          <section className="panel abilities">
            <div className="panel-heading">
              <h2>
                <em>03</em>来源与技能
              </h2>
              <button
                className="text-button"
                onClick={() => setSelected(new Set())}
                disabled={!selected.size}
              >
                清除全部
              </button>
            </div>
            <div className="ability-toolbar">
              <div className="tabs" role="tablist" aria-label="事件类型">
                {eventTypes.map((t) => (
                  <button
                    role="tab"
                    aria-selected={type === t}
                    key={t}
                    className={type === t ? "active" : ""}
                    onClick={() => setType(t)}
                  >
                    {eventLabels[t]}
                  </button>
                ))}
              </div>
              <div className="side-toggle">
                {(["friendly", "enemy"] as const).map((s) => (
                  <button
                    key={s}
                    className={side === s ? "active" : ""}
                    onClick={() => {
                      setSide(s);
                      setSource("");
                    }}
                  >
                    {s === "enemy" ? "敌方" : "友方"}
                  </button>
                ))}
              </div>
            </div>
            <div className="ability-content">
              <aside className="sources">
                <div className="column-label">来源</div>
                <button
                  className={!filter ? "source active" : "source"}
                  onClick={() => setSource("")}
                >
                  {side === "enemy" ? "所有敌方" : "所有友方"}
                </button>
                <Tree
                  nodes={nodes}
                  selected={filter?.key ?? ""}
                  onSelect={(n) => {
                    previousSource.current = n;
                    setSource(n.key);
                  }}
                />
              </aside>
              <div className="skill-list">
                <div className="skill-head">
                  <span>技能</span>
                  {!filter && <span>来源</span>}
                  <span>次数</span>
                </div>
                {loading ? (
                  <div className="empty">
                    <LoaderCircle className="spin" />
                    <p>正在加载完整技能事件…</p>
                    <button
                      onClick={() => {
                        void cache.cancelQueries();
                        setMessage("已取消加载，点击重试重新读取。");
                      }}
                    >
                      取消
                    </button>
                  </div>
                ) : shown.length ? (
                  shown.map((g, i) => (
                    <label
                      className="skill"
                      key={`${g.sourceKey}:${g.ability.gameID}:${i}`}
                    >
                      <span>
                        <input
                          type="checkbox"
                          checked={selected.has(g.key)}
                          onChange={() => toggle(g.key)}
                        />
                        <span className="skill-name">
                          {g.ability.name}
                          <small>#{g.ability.gameID}</small>
                        </span>
                      </span>
                      {!filter && (
                        <span className="source-name">{g.actor.name}</span>
                      )}
                      <b>{g.events.length}</b>
                    </label>
                  ))
                ) : (
                  <div className="empty">
                    <Activity />
                    <p>
                      {currentFight
                        ? "当前来源没有技能事件"
                        : "选择战斗，查看技能事件"}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="panel-foot">
              <span>{shown.length} 组技能</span>
              <span>已选 {selectedGroups.length} 组 · 跨标签保留</span>
            </div>
          </section>
          <section className="panel preview">
            <div className="panel-heading">
              <h2>
                <em>04</em>MRT 预览
              </h2>
              <span className="file-tag">.txt</span>
            </div>
            <div className="options">
              {(
                [
                  ["icon", "技能图标"],
                  ["friendly", "友方来源"],
                  ["enemy", "敌方来源"],
                  ["simplify", "友方简化"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) =>
                      setOptions({ ...options, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="note-wrap">
              <div className="note-label">
                <i />
                生成的团队笔记
              </div>
              <textarea
                aria-label="MRT 预览"
                spellCheck={false}
                readOnly
                value={note}
                placeholder={
                  "勾选技能后，时间轴会显示在这里。\n\n{time:00:35} 技能名称"
                }
              />
            </div>
            <div className="export-actions">
              <button
                className="primary"
                onClick={() => void copy()}
                disabled={!note}
              >
                <Clipboard size={16} />
                复制笔记
              </button>
              <button onClick={download} disabled={!note} aria-label="下载 txt">
                <Download size={17} />
              </button>
            </div>
          </section>
        </div>
        <footer>
          <span role="status">
            {loading ? (
              <>
                <LoaderCircle size={12} className="spin" />
                正在加载…
              </>
            ) : (
              <>
                <i />
                {message || "就绪"}
              </>
            )}
            {message.startsWith("已取消") && (
              <button onClick={() => void cache.invalidateQueries()}>
                重试
              </button>
            )}
          </span>
          <span>由 Warcraft Logs 数据生成 · By Ye11ow</span>
        </footer>
      </main>
    </div>
  );
}
