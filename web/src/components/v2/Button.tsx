// Buttons: primary (ink), secondary (outline), quiet (text). Sizes sm / md / lg (lg is the Overview's hero button).
// An icon-only button must say what it does (A11): `icon` makes `label` required, and the hit area is at least 32 px.
// `locked` is the demo lock: the button stays visible and focusable, says it is disabled, shows the reason, and a click
// does nothing (components/demoLock.ts). `as="link"` is a router link that looks like a button.
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { guarded, lockAttrs } from "../demoLock";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

interface Base {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Switched off by the demo lock: greyed, focusable, with the reason as a tooltip. */
  locked?: boolean;
  className?: string;
  children?: ReactNode;
}
type Naming = { icon: true; label: string } | { icon?: false; label?: string };
type AsButton = Base & Naming & { as?: "button"; ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
type AsLink = Base & Naming & { as: "link"; ref?: Ref<HTMLAnchorElement> } & Omit<LinkProps, "className" | "children" | "ref">;
export type ButtonProps = AsButton | AsLink;

export function btnClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", icon = false, className?: string, locked = false): string {
  return ["v2-btn", `v2-btn--${variant}`, size !== "md" && `v2-btn--${size}`, icon && "v2-btn--icon", locked && "is-locked", className].filter(Boolean).join(" ");
}

export function Button(props: ButtonProps) {
  const { variant, size, locked = false, className, children, icon = false, label } = props;
  const cls = btnClass(variant, size, icon, className, locked);
  if (props.as === "link") {
    const { as: _as, variant: _v, size: _s, locked: _l, className: _c, children: _ch, icon: _i, label: _lb, onClick, ...rest } = props;
    return <Link {...rest} className={cls} aria-label={label} {...lockAttrs(locked)} onClick={guarded(locked, onClick as ((e: MouseEvent<HTMLAnchorElement>) => void) | undefined)}>{children}</Link>;
  }
  const { as: _as, variant: _v, size: _s, locked: _l, className: _c, children: _ch, icon: _i, label: _lb, onClick, type = "button", ...rest } = props;
  return <button {...rest} type={type} className={cls} aria-label={label} {...lockAttrs(locked)} onClick={guarded(locked, onClick)}>{children}</button>;
}
