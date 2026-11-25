// The series list (board 07): a row per price, unusual first: name and symbol, the latest price, the change in a day, 30 days
// as a small line, how unusual the day's move is against the flag line, and the state. The open one is marked with a bar and
// aria-current. On a phone the line and the bar go, and the state moves under the name.
import type { Series } from "../../api/series";
import { Pill } from "../../components/v2/Pill";
import { Sparkline } from "../../components/v2/Sparkline";
import { Cell, Row, Table } from "../../components/v2/Table";
import { pct, price, zx } from "../../format";
import { lateSince } from "../overview/words";
import { barFill, BAR_LINE, isFlagged, oneDayZ, rowState } from "./words";

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

export const LIST_COLS = "minmax(0,1fr) 70px 58px 74px 118px 112px";
export const LIST_COLS_PHONE = "minmax(0,1fr) 72px 58px";

export function SeriesRows({ items, openId, threshold = 3 }: { items: Series[]; openId: string | null; threshold?: number }) {
  return (
    <Table label="Market series" cols={LIST_COLS} colsPhone={LIST_COLS_PHONE} closed className="v2-sr-table"
      columns={[
        { label: "Series · unusual first" }, { label: "Price", align: "right" }, { label: "1 day", align: "right" },
        { label: "30 days", phoneHide: true }, { label: `vs usual · ${threshold}× line`, phoneHide: true }, { label: "State", phoneHide: true },
      ]}>
      {items.map(s => {
        const l = s.latest, z = oneDayZ(l), th = s.detector.z_threshold;
        const stale = s.state === "stale", drawn = s.state === "moved" || s.state === "normal";
        const st = rowState(s, stale ? lateSince(s.state_reason) : null);
        return (
          <Row key={s.series_id} id={`sr-row-${s.series_id}`} to={`/series/${encodeURIComponent(s.series_id)}`} selected={s.series_id === openId}
            label={`${s.name}, ${s.symbol}: ${st.label}`} className="v2-sr-row">
            <Cell>
              <span className="v2-sr-row__name">{s.name}</span>
              <span className="v2-sr-row__sub"><span className="v2-mono v2-muted">{s.symbol}</span>
                <span className="v2-sr-row__st v2-meta"> · {st.label}</span></span>
            </Cell>
            <Cell align="right" num>{price(l?.close)}</Cell>
            <Cell align="right" num className="v2-sr-row__chg">
              {l?.change_1d_pct == null || stale ? <span className="v2-muted">—<span className="v2-sr"> no change to show</span></span> : <b>{pct(l.change_1d_pct, 1)}</b>}
            </Cell>
            <Cell phoneHide>{drawn && s.spark.length > 1 ? <Sparkline values={s.spark.map(p => p.close)} tone={s.state === "moved" ? "unusual" : "neutral"} width={70} height={22} /> : null}</Cell>
            <Cell phoneHide>{drawn ? <ZBar z={z} threshold={th} /> : <span className="v2-meta">—<span className="v2-sr"> not measured now</span></span>}</Cell>
            <Cell phoneHide><StateCell s={s} /></Cell>
          </Row>);
      })}
    </Table>
  );
}
