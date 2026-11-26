// The series list (board 07): a row per price, unusual first: name and symbol, the latest price, the change in a day, 30 days
// as a small line, how unusual the day's move is against the flag line, and the state. The open one is marked with a bar and
// aria-current. On a phone the line and the bar go, and the state moves under the name.
import type { Series } from "../../api/series";
import { Pill } from "../../components/v2/Pill";
import { Sparkline } from "../../components/v2/Sparkline";
import { Cell, Row, Table } from "../../components/v2/Table";
import { pct, price, zx } from "../../format";
import { lateSince } from "../overview/words";
import { barFill, BAR_LINE, isFlagged, oneDayZ, rowState, seriesName } from "./words";

/** How unusual a move is: a short track with a tick at the flag line, and the number after it ("4.1×"). Past the line the
 *  fill is the unusual tone, the number takes a ◆, and the words say flagged: never colour alone. */
export function ZBar({ z, threshold, label }: { z: number | null; threshold: number; label?: string }) {
  if (z === null) return <span className="v2-meta">—</span>;
  const flagged = isFlagged(z, threshold);
  return (
    <span className={`v2-sr-bar${flagged ? " is-flagged" : ""}`}>
      <span className="v2-sr-bar__track" aria-hidden="true">
        <span className="v2-sr-bar__fill" style={{ width: `${Math.round(barFill(z, threshold) * 100)}%` }} />
        <span className="v2-sr-bar__line" style={{ left: `${BAR_LINE * 100}%` }} />
      </span>
      <b className="v2-sr-bar__n v2-num"><span aria-hidden="true">{flagged ? "◆ " : ""}</span>{zx(z)}</b>
      <span className="v2-sr">{`${label ? `${label}: ` : ""}${zx(z)} a usual move; the flag line is ${threshold}×${flagged ? "; flagged" : ""}`}</span>
    </span>
  );
}

function StateCell({ s }: { s: Series }) {
  const st = rowState(s, s.state === "stale" ? lateSince(s.state_reason) : null);
  return st.tone ? <Pill tone={st.tone} mark={st.mark}>{st.label}</Pill> : <span className="v2-sr-plain">{st.label}</span>;
}

type ListCol = { key: "name" | "price" | "chg" | "spark" | "z" | "state"; label: string; width: string; phoneWidth?: string; align?: "right"; phoneHide?: boolean };
const LIST_COLUMNS: ListCol[] = [
  { key: "name", label: "Series · unusual first", width: "minmax(0,1fr)", phoneWidth: "minmax(0,1fr)" },
  { key: "price", label: "Price", width: "70px", phoneWidth: "72px", align: "right" },
  { key: "chg", label: "1 day", width: "58px", align: "right" },
  { key: "spark", label: "30 days", width: "74px", phoneHide: true },
  { key: "z", label: "", width: "118px", phoneHide: true },
  { key: "state", label: "State", width: "112px", phoneHide: true },
];

export function SeriesRows({ items, openId, threshold = 3 }: { items: Series[]; openId: string | null; threshold?: number }) {
  // a column with nothing in it on every row goes (the names get the room): 1 day when every price is late, and so on
  const hasChg = items.some(s => s.latest?.change_1d_pct != null && s.state !== "stale");
  const hasSpark = items.some(s => (s.state === "moved" || s.state === "normal") && s.spark.length > 1);
  const hasZ = items.some(s => s.state === "moved" || s.state === "normal");
  const show = (k: ListCol["key"]) => k === "chg" ? hasChg : k === "spark" ? hasSpark : k === "z" ? hasZ : true;
  const cols = LIST_COLUMNS.filter(c => show(c.key));
  const cell = (k: ListCol["key"]) => cols.some(c => c.key === k);
  const zLabel = `vs usual · ${threshold}× line`;
  return (
    <Table label="Market series" cols={cols.map(c => c.width).join(" ")} colsPhone={cols.filter(c => !c.phoneHide).map(c => c.phoneWidth ?? c.width).join(" ")} closed className="v2-sr-table"
      columns={cols.map(c => ({ label: c.key === "z" ? zLabel : c.label, align: c.align, phoneHide: c.phoneHide }))}>
      {items.map(s => {
        const l = s.latest, z = oneDayZ(l), th = s.detector.z_threshold;
        const stale = s.state === "stale", drawn = s.state === "moved" || s.state === "normal";
        const st = rowState(s, stale ? lateSince(s.state_reason) : null);
        return (
          <Row key={s.series_id} id={`sr-row-${s.series_id}`} to={`/series/${encodeURIComponent(s.series_id)}`} selected={s.series_id === openId}
            label={`${seriesName(s.name)}, ${s.symbol}: ${st.detail ?? st.label}`} className="v2-sr-row">
            <Cell>
              <span className="v2-sr-row__name">{seriesName(s.name)}</span>
              <span className="v2-sr-row__sub"><span className="v2-mono v2-muted">{s.symbol}</span>
                <span className="v2-sr-row__st v2-meta"> · {st.detail ?? st.label}</span></span>
            </Cell>
            {cell("price") && <Cell align="right" num>{price(l?.close)}</Cell>}
            {cell("chg") && <Cell align="right" num className="v2-sr-row__chg">
              {l?.change_1d_pct == null || stale ? <span className="v2-muted">—<span className="v2-sr"> no change to show</span></span> : <b>{pct(l.change_1d_pct, 1)}</b>}
            </Cell>}
            {cell("spark") && <Cell phoneHide>{drawn && s.spark.length > 1 ? <Sparkline values={s.spark.map(p => p.close)} tone={s.state === "moved" ? "unusual" : "neutral"} width={70} height={22} /> : null}</Cell>}
            {cell("z") && <Cell phoneHide>{drawn ? <ZBar z={z} threshold={th} /> : <span className="v2-meta">—<span className="v2-sr"> not measured now</span></span>}</Cell>}
            {cell("state") && <Cell phoneHide><StateCell s={s} /></Cell>}
          </Row>);
      })}
    </Table>
  );
}
