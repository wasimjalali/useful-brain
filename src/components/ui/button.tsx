import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: 32 | 34 | 36;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = 34,
  icon,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className="ub-btn ub-ring"
      data-icon={icon ? "true" : undefined}
      data-size={size}
      data-variant={variant}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label"> & {
  "aria-label": string;
};

export function IconButton({ type = "button", children, ...props }: IconButtonProps) {
  return (
    <button className="ub-iconbtn ub-ring" type={type} {...props}>
      {children}
    </button>
  );
}
