import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#F4E8DF] text-[#B45624]",
        secondary: "border-transparent bg-[#EDEAE4] text-[#78716C]",
        destructive: "border-transparent bg-[#FBEAE8] text-[#B93A2A]",
        outline: "text-[#57534E] border-[rgba(0,0,0,0.08)]",
        success: "border-transparent bg-[#E7F3EB] text-[#3D7C4F]",
        warning: "border-transparent bg-[#FDF3E3] text-[#C27A1A]",
        info: "border-transparent bg-[#EDEAE4] text-[#78716C]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
