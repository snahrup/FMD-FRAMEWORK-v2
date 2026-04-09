import * as React from "react";
import { Select, type SelectProps } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function useDesktopSelect() {
  const [isDesktop, setIsDesktop] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1024px)").matches;
  });

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const update = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(event.matches);
    };

    update(mediaQuery);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return isDesktop;
}

const MobileSelect = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, onValueChange, onChange, ...props }, ref) => {
    const isDesktop = useDesktopSelect();

    if (isDesktop) {
      return (
        <Select
          ref={ref}
          className={className}
          onChange={onChange}
          onValueChange={onValueChange}
          {...props}
        >
          {children}
        </Select>
      );
    }

    return (
      <select
        ref={ref}
        className={cn(
          "min-h-[44px] w-full rounded-md border border-[rgba(0,0,0,0.08)] bg-[#EDEAE4] px-3 py-2 text-[16px] text-[#1C1917] focus:border-[#B45624] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        {...props}
      >
        {children}
      </select>
    );
  }
);

MobileSelect.displayName = "MobileSelect";

export { MobileSelect };
export default MobileSelect;
