import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" {...props} />;
}

export const ArrowDownRight = Icon;
export const ArrowUpRight = Icon;
