// Buttons: primary (ink), secondary (outline), quiet (text). Sizes sm / md / lg (lg is the Overview's hero button).
// An icon-only button must say what it does (A11): `icon` makes `label` required, and the hit area is at least 32 px.
// `locked` is the demo lock: the button stays visible and focusable, says it is disabled, shows the reason, and a click
// does nothing (components/demoLock.ts). `as="link"` is a router link that looks like a button.
// `busy` (F3): the button is working. Its label stays (so its width never changes and a screen reader still hears it), a small
// spinner is drawn over it, aria-busy is set and clicks are ignored. `busyLabel` is what a screen reader is told while it works
// ("Checking…"), in a polite status beside the button; it is not drawn.
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { guarded, lockAttrs } from "../demoLock";
import { busyState } from "./motion";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

interface Base {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Switched off by the demo lock: greyed, focusable, with the reason as a tooltip. */
  locked?: boolean;
  /** Working: spinner over the label, width kept, clicks ignored. Pass `disabled` too if the button should look and act disabled. */
  busy?: boolean;
  /** Said to screen readers while busy, in a status beside the button ("Checking the data…"). */
  busyLabel?: string;
  className?: string;
  children?: ReactNode;
}
type Naming = { icon: true; label: string } | { icon?: false; label?: string };
type AsButton = Base & Naming & { as?: "button"; ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
type AsLink = Base & Naming & { as: "link"; ref?: Ref<HTMLAnchorElement> } & Omit<LinkProps, "className" | "children" | "ref">;
export type ButtonProps = AsButton | AsLink;

export function btnClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", icon = false, className?: string, locked = false, busy = false): string {
  return ["v2-btn", `v2-btn--${variant}`, size !== "md" && `v2-btn--${size}`, icon && "v2-btn--icon", locked && "is-locked", busy && "is-busy", className].filter(Boolean).join(" ");
}

export function Button(props: ButtonProps) {
  const { variant, size, locked = false, className, children, icon = false, label, busy = false, busyLabel } = props;
  const b = busyState(busy, undefined);
  const cls = btnClass(variant, size, icon, className, locked, busy);
  // Always in the page (empty until busy), so the change is announced; a live region added together with its words often isn't.
  const status = busyLabel != null ? <span className="v2-sr" role="status">{busy ? busyLabel : ""}</span> : null;
  if (props.as === "link") {
    const { as: _as, variant: _v, size: _s, locked: _l, className: _c, children: _ch, icon: _i, label: _lb, busy: _b, busyLabel: _bl, onClick, ...rest } = props;
    const click = guarded(locked, onClick as ((e: MouseEvent<HTMLAnchorElement>) => void) | undefined);
    return <><Link {...rest} className={cls} aria-label={label} aria-busy={b.ariaBusy || undefined} {...lockAttrs(locked)}
      onClick={e => { if (b.blocksClick) { e.preventDefault(); return; } click?.(e); }}>{children}</Link>{status}</>;
  }
  const { as: _as, variant: _v, size: _s, locked: _l, className: _c, children: _ch, icon: _i, label: _lb, busy: _b, busyLabel: _bl, onClick, type = "button", ...rest } = props;
  const click = guarded(locked, onClick);
  return <><button {...rest} type={type} className={cls} aria-label={label} aria-busy={b.ariaBusy || undefined} {...lockAttrs(locked)}
    onClick={e => { if (b.blocksClick) { e.preventDefault(); return; } click?.(e); }}>{children}</button>{status}</>;
}
